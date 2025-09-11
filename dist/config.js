// config.ts
/**
 * This file contains the central configuration for the Discourse bot.
 * It pulls sensitive data from environment variables and sets up application-wide settings.
 */
export const config = {
    // --- Discourse API Configuration ---
    discourse: {
        baseUrl: process.env.DISCOURSE_BASE_URL,
        apiKey: process.env.DISCOURSE_API_KEY,
        apiUsername: process.env.DISCOURSE_API_USERNAME || 'system',
        supportGroupName: process.env.SUPPORT_GROUP_NAME || 'support_team',
    },
    // --- OpenAI API Configuration ---
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o',
    },
    // --- Database and State Paths ---
    paths: {
        lanceDb: process.env.LANCE_DB_PATH || './data/lancedb',
        repliedPostsDb: './data/bot_state.db',
    },
    // --- Bot Behavior Settings ---
    bot: {
        instanceId: Math.random().toString(36).substring(2, 8),
        version: '4.O hybrid powered by AgentBrain',
        thinkingMessages: [
            '_Thinking..._',
            '_Processing your request..._',
            '_One moment, looking that up..._',
            '_Compiling an answer..._'
        ],
        polling_interval_seconds: 5,
        support_email: "your-support-team-email@example.com",
        max_reply_tokens: 300,
        max_intent_tokens: 10
    },
    labels: {
        replied: "Bot: Replied",
        escalated: "Bot: Escalated",
        ignored: "Bot: Ignored"
    },
};
