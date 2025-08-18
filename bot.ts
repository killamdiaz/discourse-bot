import fetch from 'node-fetch';
import { OpenAI } from 'openai';
import { vectorStore } from './lib/vector-store.js';
import { config } from './config.js';
import { initializeDatabase, loadRepliedIds as loadIdsFromDb, addRepliedId } from './lib/database.js';

interface DiscoursePost { id: number; topic_id: number; username: string; cooked: string; raw: string; }
interface DiscourseTopicResponse { post_stream: { posts: DiscoursePost[] }; title: string; }
interface DiscoursePostsResponse { latest_posts: DiscoursePost[] }

// API Clients
const openai = new OpenAI({ apiKey: config.openai.apiKey });
let repliedPostIds = new Set<number>();

type FeedbackState = 'awaiting_initial_feedback' | 'awaiting_escalation_confirmation';
const awaitingFeedback = new Map<number, { state: FeedbackState }>();
const positiveKeywords = ['yes', 'yep', 'thanks', 'thank you', 'helpful', 'perfect', 'super helpful', 'sure was', 'that worked'];
const negativeKeywords = ['no', 'nope', 'nah', 'not really', 'not helpful', "didn't work", 'not at all'];

const log = (message: string) => console.log(`[${config.bot.instanceId}] ${message}`);
const botFooter = () => `\n\n---\n> Bot v${config.bot.version}`;

function markPostAsReplied(postId: number) {
  repliedPostIds.add(postId);
  addRepliedId(postId);
}

async function apiRequest(endpoint: string, options: any = {}): Promise<any> {
  const url = `${config.discourse.baseUrl}${endpoint}`;
  const headers = { 'Api-Key': config.discourse.apiKey, 'Api-Username': config.discourse.apiUsername, 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Discourse API Error on ${endpoint}: ${res.status} - ${errorBody}`);
  }
  return res.json();
}

const fetchLatestPosts = (): Promise<DiscoursePostsResponse> => apiRequest('/posts.json');
const fetchTopicHistory = (id: number): Promise<DiscourseTopicResponse> => apiRequest(`/t/${id}.json`);
const postReply = (id: number, raw: string, includeFooter: boolean = true): Promise<{ id: number }> => apiRequest('/posts.json', { method: 'POST', body: JSON.stringify({ topic_id: id, raw: raw + (includeFooter ? botFooter() : '') }) });
const editPost = (id: number, raw: string): Promise<void> => apiRequest(`/posts/${id}.json`, { method: 'PUT', body: JSON.stringify({ post: { raw: raw + botFooter() } }) });
const sendPrivateMessage = (title: string, raw: string, group: string): Promise<void> => apiRequest('/posts.json', { method: 'POST', body: JSON.stringify({ title, raw, archetype: 'private_message', target_group_names: [group] }) });

type UserIntent = 'question' | 'bug_report' | 'escalation_request' | 'positive_feedback' | 'other';

async function determineUserIntent(postContent: string): Promise<UserIntent> {
    const prompt = config.prompts.intentClassification(postContent);
    const completion = await openai.chat.completions.create({ model: config.openai.model, messages: [{ role: 'user', content: prompt }], max_tokens: 15, temperature: 0 });
    const rawIntent = completion.choices[0].message.content?.trim().toLowerCase() || 'other';
    const cleanIntent = rawIntent.split(/[\s:]+/)[0].replace(/"/g, '');
    const validIntents: UserIntent[] = ['question', 'bug_report', 'escalation_request', 'positive_feedback', 'other'];
    if ((validIntents as string[]).includes(cleanIntent)) { return cleanIntent as UserIntent; }
    return 'other';
}

async function handleQuestion(post: DiscoursePost, topicData: DiscourseTopicResponse) {
    const startTime = Date.now();
    log(`🤖 Handling post ${post.id} as a question.`);
    markPostAsReplied(post.id);

    const randomThinkingMessage = config.bot.thinkingMessages[Math.floor(Math.random() * config.bot.thinkingMessages.length)];
    const { id: thinkingPostId } = await postReply(post.topic_id, randomThinkingMessage, false);
    if(thinkingPostId) markPostAsReplied(thinkingPostId);

    const latestUserPostContent = post.raw.replace(/<[^>]*>?/gm, '').trim();
    const similarDocs = await vectorStore.similaritySearch(latestUserPostContent, 3);
    const context = similarDocs.map(doc => doc.pageContent).join('\n---\n');

    const recentHistory = topicData.post_stream.posts.slice(-10);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = recentHistory
        .filter(p => p.id !== thinkingPostId)
        .map(p => ({
            role: p.username === config.discourse.apiUsername ? 'assistant' : 'user',
            content: `User '${p.username}' said: ${p.cooked.replace(/<[^>]*>?/gm, '').trim()}`,
        }));

    const completion = await openai.chat.completions.create({ model: config.openai.model, messages: [{ role: 'system', content: config.prompts.mainSystem(topicData.title, context) }, ...messages] });
    let aiReply = completion.choices[0].message.content;

    if (aiReply && thinkingPostId) {
        aiReply += "\n\n*Was this helpful? You can reply with 'Yes' or 'No' to let me know.*";
        await editPost(thinkingPostId, aiReply);
        
        awaitingFeedback.set(post.topic_id, { state: 'awaiting_initial_feedback' });
        log(`✅ Edited post ${thinkingPostId}. Now awaiting feedback for topic ${post.topic_id}.`);
    }
}

async function handleFeedbackReply(post: DiscoursePost) {
    log(`💬 Handling post ${post.id} as a feedback reply.`);
    markPostAsReplied(post.id);

    const feedbackSession = awaitingFeedback.get(post.topic_id);
    if (!feedbackSession) return;

    const userReply = post.raw.trim();
    const isPositive = positiveKeywords.some(keyword => new RegExp(`^\\s*${keyword}\\b`, 'i').test(userReply) && userReply.length < 30);
    const isNegative = negativeKeywords.some(keyword => new RegExp(`^\\s*${keyword}\\b`, 'i').test(userReply) && userReply.length < 30);

    if (feedbackSession.state === 'awaiting_initial_feedback') {
        if (isPositive) {
            const { id: replyId } = await postReply(post.topic_id, "Thanks, I'm glad I could help!");
            if (replyId) markPostAsReplied(replyId);
            awaitingFeedback.delete(post.topic_id);
        } else if (isNegative) {
            const { id: replyId } = await postReply(post.topic_id, "I'm sorry to hear that. Do you want me to raise a ticket for the support team?");
            if (replyId) markPostAsReplied(replyId);
            awaitingFeedback.set(post.topic_id, { state: 'awaiting_escalation_confirmation' });
        } else {
            log(`- User reply in topic ${post.topic_id} was not a clear 'Yes' or 'No'. Treating as a new question.`);
            awaitingFeedback.delete(post.topic_id);
            await processPost(post);
        }
    } else if (feedbackSession.state === 'awaiting_escalation_confirmation') {
        awaitingFeedback.delete(post.topic_id);
        if (isPositive) {
            const { id: replyId } = await postReply(post.topic_id, "Okay, I have created a ticket for the support team. They will review this conversation and get back to you here shortly.");
            if (replyId) markPostAsReplied(replyId);
            log(`- 🚨 User confirmed escalation for topic ${post.topic_id}. This is a placeholder.`);
        } else if (isNegative) {
            const { id: replyId } = await postReply(post.topic_id, "Okay, I will not escalate the situation. If you have another question, feel free to ask.");
            if (replyId) markPostAsReplied(replyId);
        }
    }
}

async function processPost(post: DiscoursePost) {
    const intent = await determineUserIntent(post.raw);
    log(`- 🧠 Intent for post ${post.id} classified as: ${intent}`);
    
    const topicData = await fetchTopicHistory(post.topic_id);
    if (!topicData) {
        log(`- ⚠️ Could not fetch topic data for post ${post.id}. Skipping.`);
        markPostAsReplied(post.id);
        return;
    }

    if (intent === 'question') {
        await handleQuestion(post, topicData);
    } else {
        markPostAsReplied(post.id);
        log(`- 💤 Ignoring post ${post.id} with non-question intent: '${intent}'. Added to memory.`); 
    }
}

const spinner = ['   ', '.  ', '.. ', '...'];
let spinnerIndex = 0;

async function runBot() {
  process.stdout.write(`[${config.bot.instanceId}] Waiting${spinner[spinnerIndex]}\r`);
  spinnerIndex = (spinnerIndex + 1) % spinner.length;

  const { latest_posts } = await fetchLatestPosts();
  if (!latest_posts) return;

  for (const post of latest_posts) {
    if (repliedPostIds.has(post.id) || post.username.toLowerCase() === config.discourse.apiUsername.toLowerCase() || post.username.toLowerCase().endsWith('bot')) {
      continue;
    }
    
    process.stdout.write('\n');
    log(`📬 Found new post! ID: ${post.id}, User: ${post.username}.`);
    
    if (awaitingFeedback.has(post.topic_id)) {
        await handleFeedbackReply(post);
    } else {
        await processPost(post);
    }
  }
}

async function startup() {
  initializeDatabase();
  repliedPostIds = loadIdsFromDb();
  log('🚀 Bot started.');
  log(`- Version: ${config.bot.version}`);
 
  const poll = async () => {
    try {
      await runBot();
    } catch (err) {
      process.stdout.write('\n');
      console.error(`[${config.bot.instanceId}] ❌ A critical error occurred in the main bot loop:`, err);
    }
    setTimeout(poll, 500);
  };
  poll();
}

startup();