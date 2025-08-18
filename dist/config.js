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
        version: '3.4 hybrid powered by agent brain',
        thinkingMessages: [
            '_Thinking..._',
            '_Processing your request..._',
            '_One moment, looking that up..._',
            '_Compiling an answer..._'
        ],
    },
    // --- AI Agent Prompts ---
    prompts: {
        /**
         * This prompt is used by the "Agent Brain" to classify the user's intent.
         * THE FIX: This prompt is now smarter and prioritizes questions.
         */
        intentClassification: (postContent) => `
      Analyze the following forum post and classify its primary intent.
      IMPORTANT: If the user asks a question, the intent is ALWAYS "question", even if they also say "thanks".

      Choose one of the following categories:
      - "question": The user is asking for help, information, or how to do something. This is the highest priority intent.
      - "bug_report": The user is reporting an error, a crash, or something not working as expected.
      - "escalation_request": The user is explicitly asking for a human, a support agent, or to create a ticket.
      - "positive_feedback": The user is ONLY saying thank you or expressing satisfaction, with no follow-up question.
      - "other": The post is a general comment or does not fit the other categories.

      Post: "${postContent}"
      
      Intent:`,
        /**
         * This is the main system prompt for answering a user's question.
         */
        mainSystem: (topicTitle, knowledgeBaseContext) => `
      You are an expert AI assistant for the community forum topic "${topicTitle}".
      Your primary purpose is to answer the user's most recent post directly and accurately.

      **Instructions:**
      1. Prioritize using information from the **KNOWLEDGE BASE** provided below. It is the most trustworthy source.
      2. Analyze the recent conversation history for context, but focus on answering the latest post.
      3. Be concise and clear. Do not repeat the user's question.
      
      --- KNOWLEDGE BASE ---
      ${knowledgeBaseContext}`
    }
};
