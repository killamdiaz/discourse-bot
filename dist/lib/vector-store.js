import { connect } from '@lancedb/lancedb';
import { OpenAI } from 'openai';
import { config } from '../config.js';
const openai = new OpenAI({
    apiKey: config.openai.apiKey,
});
/**
 * An object that provides an interface for interacting with the vector store.
 */
export const vectorStore = {
    /**
     * Searches for documents in the LanceDB table that are semantically similar to the given query.
     * @param query The user's query string.
     * @param k The number of similar documents to return.
     * @returns A promise that resolves to an array of search result documents, each with content, title, and url.
     */
    similaritySearch: async (query, k = 3) => {
        if (!query || query.trim() === '') {
            console.warn('⚠️ Similarity search called with an empty query.');
            return [];
        }
        try {
            const db = await connect(config.paths.lanceDb);
            const table = await db.openTable('discourse_threads');
            const embRes = await openai.embeddings.create({
                model: "text-embedding-ada-002",
                input: query,
            });
            const queryEmbedding = embRes.data[0].embedding;
            const results = await table
                .search(queryEmbedding)
                .limit(k)
                .select(['content', 'title', 'url']) // Explicitly select the required columns
                .toArray();
            // Return the structured data
            return results.map((doc) => ({
                content: doc.content,
                title: doc.title,
                url: doc.url,
            }));
        }
        catch (error) {
            if (error.message.includes('Table discourse_threads not found')) {
                console.warn('⚠️ Vector DB table not found. Please run an ingestor script first.');
            }
            else {
                console.error('❌ Error during similarity search:', error);
            }
            return []; // Return an empty array on failure.
        }
    }
};
