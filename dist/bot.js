import fetch from 'node-fetch';
import { OpenAI } from 'openai';
import { vectorStore } from './lib/vector-store.js';
import { config } from './config.js';
import { prompts } from './prompts.js';
import { initializeDatabase, loadRepliedIds as loadIdsFromDb, addRepliedId } from './lib/database.js';
// API Clients
const openai = new OpenAI({ apiKey: config.openai.apiKey });
let repliedPostIds = new Set();
let botStartTime = 0;
const log = (message) => console.log(`[${config.bot.instanceId}] ${message}`);
const botFooter = () => `\n\n---\n> Bot v${config.bot.version}`;
function markPostAsReplied(postId) {
    repliedPostIds.add(postId);
    addRepliedId(postId);
}
async function apiRequest(endpoint, options = {}, retries = 3, delay = 1000) {
    const url = `${config.discourse.baseUrl}${endpoint}`;
    const headers = { 'Api-Key': config.discourse.apiKey, 'Api-Username': config.discourse.apiUsername, 'Content-Type': 'application/json', ...options.headers };
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { ...options, headers });
            if (res.status === 429) {
                const errorBody = await res.json();
                const waitSeconds = errorBody.extras?.wait_seconds || delay / 1000;
                log(`- Rate limited. Waiting for ${waitSeconds} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000 + 500)); // Add 500ms buffer
                continue; // Retry the request
            }
            if (!res.ok) {
                const errorBody = await res.text();
                throw new Error(`Discourse API Error on ${endpoint}: ${res.status} - ${errorBody}`);
            }
            return res.json();
        }
        catch (error) {
            if (i === retries - 1)
                throw error;
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
}
const fetchLatestPosts = () => apiRequest('/posts.json');
const fetchTopicHistory = (id) => apiRequest(`/t/${id}.json`);
const postReply = (id, raw, includeFooter = true) => apiRequest('/posts.json', { method: 'POST', body: JSON.stringify({ topic_id: id, raw: raw + (includeFooter ? botFooter() : '') }) });
const editPost = (id, raw) => apiRequest(`/posts/${id}.json`, { method: 'PUT', body: JSON.stringify({ post: { raw: raw + botFooter() } }) });
const sendPrivateMessage = (title, raw, group) => apiRequest('/posts.json', { method: 'POST', body: JSON.stringify({ title, raw, archetype: 'private_message', target_group_names: [group] }) });
async function determineUserIntent(postContent) {
    const prompt = prompts.intent_classifier(postContent);
    const completion = await openai.chat.completions.create({ model: config.openai.model, messages: [{ role: 'user', content: prompt }], max_tokens: config.bot.max_intent_tokens, temperature: 0 });
    const rawIntent = completion.choices[0].message.content?.trim().toLowerCase() || 'other';
    const cleanIntent = rawIntent.split(/[\s:]+/)[0].replace(/"/g, '');
    const validIntents = ['question', 'escalation_request', 'follow_up', 'other'];
    if (validIntents.includes(cleanIntent)) {
        return cleanIntent;
    }
    return 'other';
}
async function generateAiReply(topicTitle, conversation_history) {
    const similarDocs = await vectorStore.similaritySearch(conversation_history[conversation_history.length - 1].content, 3);
    const context = similarDocs.map(doc => doc.pageContent).join('\n---\n');
    const system_prompt = prompts.ai_reply_system(topicTitle, context);
    const messages_for_api = [{ role: 'system', content: system_prompt }, ...conversation_history];
    try {
        const response = await openai.chat.completions.create({
            model: config.openai.model,
            messages: messages_for_api,
            max_tokens: config.bot.max_reply_tokens
        });
        return response.choices[0].message.content?.trim() ?? "I'm sorry, I encountered an error.";
    }
    catch (e) {
        console.error("Error generating AI reply:", e);
        return "I'm sorry, I encountered an error. A human agent will get back to you shortly.";
    }
}
async function processPost(post) {
    const intent = await determineUserIntent(post.raw);
    log(`- 🧠 Intent for post ${post.id} classified as: ${intent}`);
    const topicData = await fetchTopicHistory(post.topic_id);
    if (!topicData) {
        log(`- ⚠️ Could not fetch topic data for post ${post.id}. Skipping.`);
        markPostAsReplied(post.id);
        return;
    }
    const conversation_history = topicData.post_stream.posts.map(p => ({
        role: p.username === config.discourse.apiUsername ? 'assistant' : 'user',
        content: p.cooked.replace(/<[^>]*>?/gm, '').trim(),
    }));
    switch (intent) {
        case 'question':
            log(`🤖 Handling post ${post.id} as a question.`);
            const reply_text = await generateAiReply(topicData.title, conversation_history);
            const { id: replyId } = await postReply(post.topic_id, reply_text);
            if (replyId)
                markPostAsReplied(replyId);
            markPostAsReplied(post.id);
            break;
        case 'escalation_request':
            log(`- 🚨 Escalating post ${post.id}.`);
            const escalationText = "Your request has been escalated to our human support team.";
            const { id: escalationReplyId } = await postReply(post.topic_id, escalationText);
            if (escalationReplyId)
                markPostAsReplied(escalationReplyId);
            // Here you can add logic to forward to a support email or create a ticket
            markPostAsReplied(post.id);
            break;
        case 'follow_up':
        case 'other':
            log(`- 💤 Ignoring post ${post.id} with intent: '${intent}'.`);
            markPostAsReplied(post.id);
            break;
    }
}
const spinner = ['   ', '.  ', '.. ', '...'];
let spinnerIndex = 0;
async function runBot() {
    process.stdout.write(`[${config.bot.instanceId}] Waiting${spinner[spinnerIndex]}\r`);
    spinnerIndex = (spinnerIndex + 1) % spinner.length;
    const { latest_posts } = await fetchLatestPosts();
    if (!latest_posts)
        return;
    for (const post of latest_posts) {
        const postCreationTime = new Date(post.created_at).getTime();
        if (postCreationTime < botStartTime || repliedPostIds.has(post.id) || post.username.toLowerCase() === config.discourse.apiUsername.toLowerCase() || post.username.toLowerCase().endsWith('bot')) {
            continue;
        }
        process.stdout.write('\n');
        log(`📬 Found new post! ID: ${post.id}, User: ${post.username}.`);
        await processPost(post);
    }
}
async function startup() {
    initializeDatabase();
    repliedPostIds = loadIdsFromDb();
    botStartTime = Date.now(); // Set the start time
    log('🚀 Bot started.');
    log(`- Version: ${config.bot.version}`);
    const poll = async () => {
        try {
            await runBot();
        }
        catch (err) {
            process.stdout.write('\n');
            console.error(`[${config.bot.instanceId}] ❌ A critical error occurred in the main bot loop:`, err);
        }
        setTimeout(poll, config.bot.polling_interval_seconds * 1000);
    };
    poll();
}
startup();
