import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { config } from './config.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag} to send setup message!`);

  const guild = client.guilds.cache.get(config.discord.guildId);
  if (!guild) {
    console.error(`Could not find guild with ID ${config.discord.guildId}`);
    process.exit(1);
  }

  const channel = guild.channels.cache.get(config.discord.ticketChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`Could not find text channel with ID ${config.discord.ticketChannelId}`);
    process.exit(1);
  }

  const messages = await channel.messages.fetch({ limit: 10 });
  const botMessages = messages.filter(m => m.author.id === client.user?.id);
  if (botMessages.size > 0) {
      await channel.bulkDelete(botMessages);
      console.log(`- Deleted ${botMessages.size} old bot message(s).`);
  }

  const ticketEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('Create a Support Ticket')
    .setDescription('Click the button below to open a private ticket with our support team.')
    .setFooter({ text: 'You will be added to a private thread.' });

  const ticketButton = new ButtonBuilder()
    .setCustomId('create_ticket_button')
    .setLabel('Create Ticket')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🎟️');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(ticketButton);

  await (channel as TextChannel).send({
    embeds: [ticketEmbed],
    components: [row],
  });

  console.log('✅ Ticket creation message sent successfully!');
  client.destroy();
});

client.login(config.discord.token);