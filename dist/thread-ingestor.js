import axios from 'axios';
import { htmlToText } from 'html-to-text';
import { OpenAI } from 'openai';
import { connect } from '@lancedb/lancedb';
import { config } from './config.js';
// Initialize the OpenAI client using the central configuration.
const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});
/**
 * Ingests recent threads from the Discourse forum into the LanceDB vector store.
 * This script connects to the database, checks for new topics, creates vector embeddings,
 * and adds the new documents to the 'discourse_threads' table.
 * @param limit The maximum number of new topics to process in a single run.
 */
export async function ingestThreads(limit = 20) {
    console.log('🚀 Starting ingestion process...');
    // --- 1. Connect to Database & Open/Create Table ---
    const db = await connect(config.paths.lanceDb);
    let table;
    try {
        table = await db.openTable('discourse_threads');
        console.log(`📚 Opened existing table "discourse_threads".`);
    }
    catch (e) {
        console.log('✨ Table "discourse_threads" not found, creating a new one...');
        const sampleData = [{
                id: '', title: '', url: '', content: '',
                vector: Array(1536).fill(0), // OpenAI text-embedding-ada-002 uses 1536 dimensions
            }];
        table = await db.createTable('discourse_threads', sampleData);
        await table.delete("id = ''"); // Clean up the placeholder record
        console.log('✅ New table created successfully.');
    }
    // --- 2. Fetch Existing Document IDs for Duplicate Checking ---
    console.log('🔍 Fetching existing document IDs to prevent duplicates...');
    const allRecords = await table.query().select(['id']).toArray();
    const existingIds = new Set(allRecords.map((doc) => doc.id));
    console.log(`- Found ${existingIds.size} existing documents in the database.`);
    // --- 3. Fetch Latest Topics from Discourse ---
    const topics = await axios.get(`${config.discourse.baseUrl}/latest.json`, {
        headers: { 'Api-Key': config.discourse.apiKey, 'Api-Username': config.discourse.apiUsername },
    }).then(res => res.data.topic_list.topics);
    console.log(`- Fetched ${topics.length} latest topics to check.`);
    // --- 4. Process Each Topic and Prepare New Documents ---
    const newDocs = [];
    let ingestedCount = 0;
    for (const topic of topics) {
        if (ingestedCount >= limit) {
            console.log(`- Reached ingestion limit of ${limit}. Stopping.`);
            break;
        }
        const id = topic.id.toString();
        if (existingIds.has(id))
            continue; // Skip if already in the database
        try {
            console.log(`\nProcessing Topic ${id}: "${topic.title}"`);
            const details = await axios.get(`${config.discourse.baseUrl}/t/${topic.id}.json`, {
                headers: { 'Api-Key': config.discourse.apiKey, 'Api-Username': config.discourse.apiUsername },
            }).then(res => res.data);
            const posts = details.post_stream?.posts || [];
            const combinedHtml = posts.map((p) => p.cooked).join('\n\n');
            const content = htmlToText(combinedHtml, { wordwrap: false, selectors: [{ selector: 'a', format: 'skip' }] });
            if (!content || content.trim().length < 50) {
                console.warn(`- ⚠️ Skipping topic ${topic.id} due to short content.`);
                continue;
            }
            const input = content.slice(0, 8192);
            const embRes = await openai.embeddings.create({ model: "text-embedding-ada-002", input });
            const embedding = embRes.data[0].embedding;
            const url = `${config.discourse.baseUrl}/t/${details.slug || topic.slug}/${details.id}`;
            newDocs.push({ id, title: details.title, url, content, vector: embedding });
            ingestedCount++;
            console.log(`- ✅ Prepared topic ${id} for ingestion.`);
        }
        catch (err) {
            console.error(`- ❌ Failed to process topic ${id}:`, err.message || err);
        }
    }
    // --- 5. Add New Documents to the Database ---
    if (newDocs.length > 0) {
        console.log(`\n➕ Adding ${newDocs.length} new documents to the database...`);
        await table.add(newDocs);
        console.log('✅ Successfully added documents.');
    }
    else {
        console.log('\n✨ No new documents to add.');
    }
    const finalCount = await table.countRows();
    console.log(`🏁 Ingestion complete. Vector DB now contains ${finalCount} total documents.`);
}
// This allows the script to be run directly via "npm run ingest"
ingestThreads().catch((err) => {
    console.error("An unexpected error occurred during the ingestion process:", err);
    process.exit(1);
});
