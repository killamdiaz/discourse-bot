import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  ThreadAutoArchiveDuration,
  Partials,
  MessageFlags,
  GuildMember,
} from 'discord.js';
import { OpenAI } from 'openai';
import { vectorStore } from './lib/vector-store.js';
import { config } from './config.js';
import { prompts } from './prompts.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

type UserIntent = 'question' | 'escalation_request' | 'follow_up' | 'other';

const DEFAULT_ERROR_MESSAGE = "I'm sorry, I encountered a technical issue and couldn't process your request. A human agent has been notified.";

async function determineUserIntent(postContent: string): Promise<UserIntent> {
    const prompt = prompts.intent_classifier(postContent);
    try {
        const completion = await openai.chat.completions.create({
            model: config.openai.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: config.bot.max_intent_tokens,
            temperature: 0,
        });
        const rawIntent = completion.choices[0].message.content?.trim().toLowerCase() || 'other';
        const cleanIntent = rawIntent.split(/[\s:]+/)[0].replace(/"/g, '');
        const validIntents: UserIntent[] = ['question', 'escalation_request', 'follow_up', 'other'];
        if ((validIntents as string[]).includes(cleanIntent)) { return cleanIntent as UserIntent; }
        return 'other';
    } catch (error) {
        console.error("Error determining user intent:", error);
        return 'other';
    }
}

async function generateAiReply(topicTitle: string, conversation_history: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
    const lastUserMessage = conversation_history[conversation_history.length - 1].content as string;
    
    const similarDocs = await vectorStore.similaritySearch(lastUserMessage, 5);

    if (similarDocs.length === 0) {
        return "I'm sorry, I couldn't find any relevant information in my knowledge base to answer your question. If you'd like, I can escalate this to a human agent.";
    }

    const formattedContext = similarDocs
        .map((doc, index) => `[Source ${index + 1}: ${doc.title}]\n${doc.content}`)
        .join('\n\n---\n\n');

    const system_prompt = prompts.ai_reply_system(topicTitle, formattedContext);
    const messages_for_api: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system_prompt }, ...conversation_history];
    
    try {
        const response = await openai.chat.completions.create({ model: config.openai.model, messages: messages_for_api, max_tokens: config.bot.max_reply_tokens });
        const aiResponse = response.choices[0].message.content;

        // --- ROBUSTNESS FIX ---
        if (!aiResponse || aiResponse.trim() === '') {
            console.error("OpenAI returned an empty or null response.");
            return DEFAULT_ERROR_MESSAGE;
        }

        const sources = similarDocs.map((doc, index) => {
            if (aiResponse.includes(`[${index + 1}]`)) {
                const link = doc.url.startsWith('http') ? `[${doc.title}](${doc.url})` : doc.title;
                return `${index + 1}. ${link}`;
            }
            return null;
        }).filter(Boolean);

        let finalReply = aiResponse;
        if (sources.length > 0) {
            finalReply = `${aiResponse}\n\n**Sources:**\n${sources.join('\n')}`;
        }
        
        return finalReply.trim() === '' ? DEFAULT_ERROR_MESSAGE : finalReply;

    } catch (e) {
        console.error("Error generating AI reply:", e);
        return DEFAULT_ERROR_MESSAGE;
    }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });

client.once(Events.ClientReady, c => { console.log(`🚀 Discord Bot is ready! Logged in as ${c.user.tag}`); });

// --- All event listeners remain the same ---
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton() && interaction.customId === 'create_ticket_button') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
                await interaction.editReply({ content: 'This button can only be used in a server text channel.' });
                return;
            }
            const thread = await interaction.channel.threads.create({ name: `ticket-${interaction.user.username}`, type: ChannelType.PrivateThread });
            await thread.members.add(interaction.user.id);
            await thread.send(`Hi ${interaction.user.toString()}, welcome to your private support ticket! Please describe your issue, and I'll do my best to help.`);
            await interaction.editReply({ content: `Your private ticket has been created: ${thread.toString()}` });
        } catch (error) {
            console.error('Failed to create ticket thread:', error);
            await interaction.editReply({ content: 'Sorry, I was unable to create a ticket.' });
        }
        return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'close') {
        if (!interaction.channel?.isThread()) {
            await interaction.reply({ content: 'This command can only be used inside a ticket thread.', flags: MessageFlags.Ephemeral });
            return;
        }
        const owner = await interaction.channel.fetchOwner();
        const threadOwnerId = owner?.id;
        const member = interaction.member as GuildMember;
        const canClose = member.id === threadOwnerId || member.roles.cache.has(config.discord.supportRoleId);
        if (!canClose) {
            await interaction.reply({ content: 'You do not have permission to close this ticket.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.reply({ content: 'Closing this ticket...' });
        await interaction.channel.send('This ticket has been closed and will be archived.');
        await interaction.channel.setLocked(true);
        await interaction.channel.setArchived(true);
    }
});
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild || !message.channel.isThread() || (message.channel.parentId !== config.discord.ticketChannelId && message.channel.parentId !== config.discord.forumChannelId)) return;
    const intent = await determineUserIntent(message.content);
    console.log(`📬 Message in private ticket ${message.channel.name}. Intent: ${intent}`);
    switch (intent) {
        case 'question':
            await message.channel.sendTyping();
            const messages = await message.channel.messages.fetch({ limit: 20 });
            const conversation_history: OpenAI.Chat.ChatCompletionMessageParam[] = messages.reverse().map(msg => ({ role: msg.author.id === client.user?.id ? 'assistant' : 'user', content: msg.content }));
            const reply_text = await generateAiReply(message.channel.name, conversation_history);
            await message.channel.send(reply_text);
            break;
        case 'escalation_request':
            await message.reply(`I understand. I've notified the support team (<@&${config.discord.supportRoleId}>) to look into this ticket personally.`);
            break;
        case 'follow_up':
        case 'other':
            const lastMessages = await message.channel.messages.fetch({ limit: 1, before: message.id });
            const lastMessage = lastMessages.first();
            if (lastMessage && lastMessage.author.id === client.user?.id && lastMessage.content.includes('escalate')) {
                console.log(`- User confirmed escalation for ticket ${message.channel.name}.`);
                await message.reply(`Understood. I have notified the support team (<@&${config.discord.supportRoleId}>) for you.`);
            } else {
                console.log(`- Ignoring message with intent '${intent}'.`);
            }
            break;
    }
});
client.on(Events.ThreadCreate, async (thread) => {
    if (thread.parentId !== config.discord.forumChannelId) return;
    console.log(`📬 New post created in community support forum: "${thread.name}"`);
    try {
        const starterMessage = await thread.fetchStarterMessage();
        if (!starterMessage) {
            console.log('- Could not fetch starter message.');
            return;
        }
        await thread.send(`Thanks for your question, ${starterMessage.author.toString()}! I'm looking into it now...`);
        const intent = await determineUserIntent(starterMessage.content);
        console.log(`- Forum post intent: ${intent}`);
        if (intent === 'question') {
            const conversation_history = [{ role: 'user' as const, content: starterMessage.content }];
            const reply_text = await generateAiReply(thread.name, conversation_history);
            await thread.send(reply_text);
        } else {
            await thread.send(`I've noted your post. A member of the <@&${config.discord.supportRoleId}> will see it shortly.`);
        }
    } catch (error) {
        console.error(`- Error processing forum post ${thread.id}:`, error);
    }
});

client.login(config.discord.token);