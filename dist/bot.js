import fetch from 'node-fetch';
import { OpenAI } from 'openai';
import { vectorStore } from './lib/vector-store.js';
import fs from 'fs/promises';
// --- Helper Functions & Interfaces ---
function getEnv(key) {
    const value = process.env[key];
    if (!value)
        throw new Error(`Missing required environment variable: ${key}`);
    return value;
}
// --- Configuration ---
const DISCOURSE_API_KEY = getEnv('DISCOURSE_API_KEY');
const DISCOURSE_API_USERNAME = getEnv('DISCOURSE_API_USERNAME');
const DISCOURSE_BASE_URL = getEnv('DISCOURSE_BASE_URL');
const REPLIED_POSTS_DB_PATH = './data/replied_posts.json';
const thinkingMessages = [
    '_Thinking..._',
    '_Processing your request..._',
    '_One moment, looking that up..._',
    '_Compiling an answer..._'
];
const negativeKeywords = ['no', 'nope', 'nah', 'not really', 'not helpful', "didn't get it", 'not at all'];
const positiveKeywords = ['yes', 'yep', 'thanks', 'thank you', 'helpful', 'perfect', 'super helpful', 'sure was'];
const openai = new OpenAI({
    apiKey: getEnv('OPENAI_API_KEY')
});
const awaitingFeedback = new Map();
let repliedPostIds = new Set();
async function loadRepliedIds() {
    try {
        const data = await fs.readFile(REPLIED_POSTS_DB_PATH, 'utf-8');
        repliedPostIds = new Set(JSON.parse(data));
        console.log(`✅ Loaded ${repliedPostIds.size} replied post IDs from file.`);
    }
    catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            console.log('No replied posts database found. Starting fresh.');
            repliedPostIds = new Set();
        }
        else {
            throw error;
        }
    }
}
async function saveRepliedIds() {
    await fs.mkdir('./data', { recursive: true });
    const data = JSON.stringify(Array.from(repliedPostIds));
    await fs.writeFile(REPLIED_POSTS_DB_PATH, data);
}
async function fetchTopicHistory(topic_id) {
    const res = await fetch(`${DISCOURSE_BASE_URL}/t/${topic_id}.json`, {
        headers: { 'Api-Key': DISCOURSE_API_KEY, 'Api-Username': DISCOURSE_API_USERNAME },
    });
    if (!res.ok) {
        console.error(`Failed to fetch topic history for topic ${topic_id}. Status: ${res.status}`);
        return null;
    }
    return await res.json();
}
async function postReply(topic_id, raw) {
    const res = await fetch(`${DISCOURSE_BASE_URL}/posts.json`, {
        method: 'POST',
        headers: { 'Api-Key': DISCOURSE_API_KEY, 'Api-Username': DISCOURSE_API_USERNAME, 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id, raw }),
    });
    if (!res.ok) {
        const errorBody = await res.text();
        console.error(`❌ Failed to post reply. Status: ${res.status}`);
        console.error('❌ Discourse Error Body:', errorBody);
        throw new Error('Failed to post reply to Discourse.');
    }
    const jsonResponse = await res.json();
    return jsonResponse.id;
}
async function editPost(post_id, new_content) {
    const res = await fetch(`${DISCOURSE_BASE_URL}/posts/${post_id}.json`, {
        method: 'PUT',
        headers: { 'Api-Key': DISCOURSE_API_KEY, 'Api-Username': DISCOURSE_API_USERNAME, 'Content-Type': 'application/json' },
        body: JSON.stringify({ post: { raw: new_content } }),
    });
    if (!res.ok) {
        const errorBody = await res.text();
        console.error(`❌ Failed to edit post ${post_id}. Status: ${res.status}`);
        console.error('❌ Discourse Error Body:', errorBody);
        throw new Error('Failed to edit post.');
    }
}
const spinner = ['   ', '.  ', '.. ', '...'];
let spinnerIndex = 0;
async function runBot() {
    process.stdout.write(`Waiting${spinner[spinnerIndex]}\r`);
    spinnerIndex = (spinnerIndex + 1) % spinner.length;
    try {
        const res = await fetch(`${DISCOURSE_BASE_URL}/posts.json`, {
            headers: { 'Api-Key': DISCOURSE_API_KEY, 'Api-Username': DISCOURSE_API_USERNAME },
        });
        const response = await res.json();
        if (!response.latest_posts)
            return;
        for (const post of response.latest_posts) {
            if (repliedPostIds.has(post.id) || post.username === DISCOURSE_API_USERNAME) {
                continue;
            }
            let isNewPost = true;
            if (awaitingFeedback.has(post.topic_id)) {
                const feedbackInfo = awaitingFeedback.get(post.topic_id);
                const userReply = post.raw.trim().toLowerCase();
                if (feedbackInfo.state === 'awaiting_initial_feedback') {
                    const isPositive = positiveKeywords.some(keyword => userReply.includes(keyword));
                    const isNegative = negativeKeywords.some(keyword => userReply.includes(keyword));
                    if (isPositive || isNegative) {
                        isNewPost = false;
                        repliedPostIds.add(post.id);
                        await saveRepliedIds();
                        awaitingFeedback.delete(post.topic_id);
                        if (isPositive) {
                            await postReply(post.topic_id, "Great! Glad I could help.");
                        }
                        else {
                            awaitingFeedback.set(post.topic_id, { state: 'awaiting_escalation_confirmation' });
                            await postReply(post.topic_id, "I'm sorry to hear that. Would you like me to create a private ticket for our support team?");
                        }
                    }
                    else {
                        awaitingFeedback.delete(post.topic_id);
                        console.log(`\n💬 User posted a follow-up in topic ${post.topic_id}. Switching out of feedback mode.`);
                    }
                }
                else if (feedbackInfo.state === 'awaiting_escalation_confirmation') {
                    isNewPost = false;
                    repliedPostIds.add(post.id);
                    await saveRepliedIds();
                    awaitingFeedback.delete(post.topic_id);
                    if (userReply.includes('yes')) {
                        await postReply(post.topic_id, "Okay, your request has been forwarded to the support team. They will review this topic and get back to you here.");
                    }
                    else {
                        await postReply(post.topic_id, "Okay, I won't escalate this for now. If you have any other questions, feel free to ask.");
                    }
                }
            }
            if (isNewPost) {
                process.stdout.write('\n');
                const startTime = Date.now();
                console.log(`🤖 Responding to new post ID ${post.id} in topic ${post.topic_id}`);
                repliedPostIds.add(post.id);
                await saveRepliedIds();
                const randomThinkingMessage = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
                const thinkingPostId = await postReply(post.topic_id, randomThinkingMessage);
                console.log(`💬 Posted '${randomThinkingMessage}' message with ID ${thinkingPostId}`);
                const topicData = await fetchTopicHistory(post.topic_id);
                const recentHistory = topicData ? topicData.post_stream.posts.slice(-10) : [];
                const messages = recentHistory
                    .filter(p => p.cooked && p.id !== thinkingPostId)
                    .map(p => {
                    const plainText = p.cooked.replace(/<[^>]*>?/gm, '');
                    return {
                        role: p.username === DISCOURSE_API_USERNAME ? 'assistant' : 'user',
                        content: `The user '${p.username}' said: ${plainText.trim()}`,
                    };
                });
                const latestUserContent = messages.length > 0 ? messages[messages.length - 1].content : '';
                const similarDocs = await vectorStore.similaritySearch(latestUserContent, 3);
                const context = similarDocs.map(doc => doc.pageContent).join('\n---\n');
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an expert AI assistant for the "${topicData?.title}" topic on a community forum. 
              You were created by Zaid Mallik.
              Your primary purpose is to answer user questions based on the provided conversation history and an internal knowledge base.\n\n**Instructions:**\n1. 
              Carefully analyze the **entire conversation transcript** to understand the user's full request.\n2. Prioritize using information from the **KNOWLEDGE BASE** if it is provided and relevant.
              \n3. Answer the user's most recent post directly and accurately.\n4. Do NOT provide generic, off-topic answers.\n\n--- KNOWLEDGE BASE ---\n${context}`
                        },
                        ...messages
                    ]
                });
                const aiReply = completion.choices[0].message.content;
                if (aiReply) {
                    const fullReply = `${aiReply}\n\n---\n*Was this helpful? You can reply with 'Yes' or 'No' to let me know.*`;
                    await editPost(thinkingPostId, fullReply);
                    const endTime = Date.now();
                    const durationInSeconds = (endTime - startTime) / 1000;
                    console.log(`✅ Edited post ${thinkingPostId} with final answer.`);
                    console.log(`⏱️ Total response time: ${durationInSeconds.toFixed(2)} seconds.`);
                    awaitingFeedback.set(post.topic_id, { state: 'awaiting_initial_feedback' });
                    console.log(`💬 Awaiting feedback for topic ${post.topic_id}`);
                }
            }
        }
    }
    catch (err) {
        process.stdout.write('\n');
        console.error('❌ Bot error:', err);
    }
}
// --- Startup ---
async function startup() {
    await loadRepliedIds();
    console.log('🚀 Bot started.');
    setInterval(runBot, 3000);
    runBot();
}
startup();
