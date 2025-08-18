import { connect } from '@lancedb/lancedb';
import { OpenAI } from 'openai';
import { config } from '../config.js';
// Initialize the OpenAI client using the central configuration.
const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});
/**
 * A high-performance vector store that connects to LanceDB to perform similarity searches.
 */
export const vectorStore = {
    /**
     * Searches for documents in the LanceDB table that are semantically similar to the given query.
     * @param query The user's query string.
     * @param k The number of similar documents to return.
     * @returns A promise that resolves to an array of the top k search results.
     */
    similaritySearch: async (query, k = 3) => {
        // Don't waste API calls on empty queries.
        if (!query || query.trim() === '') {
            console.warn('⚠️ Similarity search called with an empty query.');
            return [];
        }
        try {
            // 1. Connect to the LanceDB database.
            const db = await connect(config.paths.lanceDb);
            const table = await db.openTable('discourse_threads');
            // 2. Create an embedding for the user's query using OpenAI.
            const embRes = await openai.embeddings.create({
                model: "text-embedding-ada-002",
                input: query,
            });
            const queryEmbedding = embRes.data[0].embedding;
            // 3. Perform the similarity search directly in LanceDB.
            // This is extremely fast as it uses the database's native vector index.
            const results = await table
                .search(queryEmbedding)
                .limit(k)
                .toArray();
            // 4. Format the results into the expected structure for the bot.
            // The '_distance' and 'vector' columns are automatically included but we can ignore them.
            return results.map((doc) => ({
                pageContent: `Title: ${doc.title}\nContent: ${doc.content}\nURL: ${doc.url}`
            }));
        }
        catch (error) {
            // Provide helpful error messages if something goes wrong.
            if (error.message.includes('Table discourse_threads not found')) {
                console.warn('⚠️ Vector DB table not found. Please run the ingestor script first (`npm run ingest`).');
            }
            else {
                console.error('❌ Error during similarity search:', error);
            }
            return []; // Return an empty array on failure.
        }
    }
};
