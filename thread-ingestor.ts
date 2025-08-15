import axios from 'axios';
import { htmlToText } from 'html-to-text';
import OpenAI from 'openai';

// regular functions (these exist at runtime)
import { loadVectorStore, saveVectorStore } from './lib/vector-store.js';

// types/interfaces (these only exist at compile time)
import type { VectorDocument } from './lib/vector-store.js';

// The dotenv.config() line has been removed from here.

const DISCOURSE_BASE_URL = process.env.DISCOURSE_BASE_URL;
const DISCOURSE_API_KEY = process.env.DISCOURSE_API_KEY;
const DISCOURSE_API_USERNAME = process.env.DISCOURSE_API_USERNAME;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VECTOR_DB_PATH = process.env.VECTOR_DB_PATH || './data/vector_db.json';

if (!DISCOURSE_BASE_URL || !DISCOURSE_API_KEY || !DISCOURSE_API_USERNAME) {
  console.error('Missing Discourse API configuration. Please define DISCOURSE_BASE_URL, DISCOURSE_API_KEY and DISCOURSE_API_USERNAME in your environment.');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('Missing OpenAI API key. Please define OPENAI_API_KEY in your environment.');
  process.exit(1);
}

// Initialize OpenAI API client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});


/**
 * Fetch the latest topics from the Discourse API.
 */
async function fetchLatestTopics(page = 0): Promise<any[]> {
  const url = `${DISCOURSE_BASE_URL}/latest.json${page > 0 ? `?page=${page}` : ''}`;
  const res = await axios.get(url, {
    headers: {
      'Api-Key': DISCOURSE_API_KEY,
      'Api-Username': DISCOURSE_API_USERNAME,
    },
  });
  return res.data.topic_list.topics as any[];
}

/**
 * Fetch the full contents of a single topic.
 * @param topicId Numeric ID of the topic
 */
async function fetchTopicDetails(topicId: number): Promise<any> {
  const url = `${DISCOURSE_BASE_URL}/t/${topicId}.json?print=true`;
  const res = await axios.get(url, {
    headers: {
      'Api-Key': DISCOURSE_API_KEY,
      'Api-Username': DISCOURSE_API_USERNAME,
    },
  });
  return res.data;
}

/**
 * Ingests recent threads from the forum into the vector store.
 * @param limit Maximum number of topics to ingest per run
 */
export async function ingestThreads(limit = 20): Promise<void> {
  const existingDocs = await loadVectorStore(VECTOR_DB_PATH);
  const existingIds = new Set(existingDocs.map((doc) => doc.id));
  let topics: any[] = [];
  try {
    topics = await fetchLatestTopics();
  } catch (err) {
    console.error('Error fetching latest topics:', err);
    return;
  }
  const newDocs: VectorDocument[] = [...existingDocs];
  let ingestedCount = 0;
  for (const topic of topics) {
    if (ingestedCount >= limit) break;
    const id = topic.id.toString();
    if (existingIds.has(id)) continue;
    try {
      const details = await fetchTopicDetails(topic.id);
      const posts = details.post_stream?.posts || [];
      const combinedHtml = posts.map((p: any) => p.cooked).join('\n\n');
      const content = htmlToText(combinedHtml, {
        wordwrap: false,
        selectors: [ { selector: 'a', format: 'skip' } ],
      });

      if (!content || content.trim().length === 0) {
          console.warn(`⚠ Skipping topic ${topic.id} — empty content`);
          continue;
        }
      if (content.length > 8000) {
          console.warn(`⚠ Skipping topic ${topic.id} — content too long (${content.length} chars)`);
          continue;
        }

      const input = content.slice(0, 8192);

      const embRes = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input,
      });
      
      if (!embRes.data || !embRes.data[0] || !embRes.data[0].embedding) {
        console.error(`❌ No embedding returned for topic ${id}`);
        continue;
      }
  
      const embedding = embRes.data[0].embedding;
      const slug = details.slug || topic.slug || '';
      const url = `${DISCOURSE_BASE_URL}/t/${slug}/${details.id}`;
      newDocs.push({ id, title: details.title, url, content, embedding });
      ingestedCount++;
      console.log(`Ingested topic ${id}: ${details.title}`);
    } catch (err) {
      console.error(`Failed to ingest topic ${topic.id}`, err);
    }
  }
  await saveVectorStore(VECTOR_DB_PATH, newDocs);
  console.log(`Ingestion complete. Vector DB now contains ${newDocs.length} documents.`);
}

// Only run if called directly
if (process.argv[1]?.endsWith('thread-ingestor.ts')) {
  ingestThreads().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}