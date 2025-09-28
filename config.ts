export const config = {
  discourse: {
    baseUrl: process.env.DISCOURSE_BASE_URL!,
    apiKey: process.env.DISCOURSE_API_KEY!,
    apiUsername: process.env.DISCOURSE_API_USERNAME || 'system',
    supportGroupName: process.env.SUPPORT_GROUP_NAME || 'support_team',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o',
  },
  
  paths: {
    lanceDb: process.env.LANCE_DB_PATH || './data/lancedb',
    repliedPostsDb: './data/bot_state.db',
  },

  discord: {
    token: process.env.DISCORD_BOT_TOKEN!,
    clientId: process.env.DISCORD_CLIENT_ID!,
    guildId: process.env.DISCORD_GUILD_ID!,
    ticketChannelId: process.env.DISCORD_TICKET_CHANNEL_ID!,
    supportRoleId: process.env.DISCORD_SUPPORT_ROLE_ID!,
    forumChannelId: process.env.DISCORD_FORUM_CHANNEL_ID!,
  },

  bot: {
    instanceId: Math.random().toString(36).substring(2, 8),
    version: '4.O hybrid powered by AgentBrain',
    thinkingMessages: [ /* ... */ ],
    polling_interval_seconds: 5,
    support_email: "your-support-team-email@example.com",
    max_reply_tokens: 300,
    max_intent_tokens: 10
  },
  labels: { /* ... */ },
};