import fs from 'fs';
import { OpenAI } from 'openai';
import { cosineSimilarity } from 'vector-cosine-similarity';
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
// --- Functions to save and load the vector database from a file ---
export async function saveVectorStore(path, docs) {
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(path, JSON.stringify(docs, null, 2));
}
export async function loadVectorStore(path) {
    try {
        const data = await fs.promises.readFile(path, 'utf-8');
        return JSON.parse(data);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
// --- The Core Search Function ---
export const vectorStore = {
    similaritySearch: async (query, k = 3) => {
        const dbPath = process.env.VECTOR_DB_PATH || './data/vector_db.json';
        const allDocs = await loadVectorStore(dbPath);
        if (allDocs.length === 0) {
            console.warn('Vector store is empty. No documents to search.');
            return [];
        }
        // 1. Create an embedding for the user's query
        const queryEmbeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: query,
        });
        const queryEmbedding = queryEmbeddingResponse.data[0].embedding;
        // 2. Calculate similarity for each document
        const similarities = allDocs.map(doc => ({
            doc: doc,
            score: cosineSimilarity(queryEmbedding, doc.embedding)
        }));
        // 3. Sort by score in descending order
        similarities.sort((a, b) => b.score - a.score);
        // 4. Get the top 'k' results
        const topResults = similarities.slice(0, k);
        // 5. Format the results
        return topResults.map(result => ({
            pageContent: `Title: ${result.doc.title}\nContent: ${result.doc.content}\nURL: ${result.doc.url}`
        }));
    }
};
