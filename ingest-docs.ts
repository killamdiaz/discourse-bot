import fs from 'fs';
import path from 'path';
import { connect, Table } from '@lancedb/lancedb';
import { OpenAI } from 'openai';
import { config } from './config.js';
import pdf from 'pdf-parse';
import { chunkText } from './lib/utils.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey }); //
const DOCS_PATH = path.join(process.cwd(), 'knowledge_base');

export async function ingestDocs(): Promise<void> {
    console.log('🚀 Starting document ingestion process...');

    const db = await connect(config.paths.lanceDb); //
    let table: Table;

    try {
        table = await db.openTable('discourse_threads');
        console.log(`📚 Opened existing table "discourse_threads".`);
    } catch (e) {
        console.log('✨ Table "discourse_threads" not found, creating a new one...');
        const sampleData = [{ id: '', title: '', url: '', content: '', vector: Array(1536).fill(0) }];
        table = await db.createTable('discourse_threads', sampleData);
        await table.delete("id = ''");
        console.log('✅ New table created successfully.');
    }

    const files = fs.readdirSync(DOCS_PATH);
    const newDocs = [];
    console.log(`- Found ${files.length} files in ${DOCS_PATH}.`);

    for (const file of files) {
        const filePath = path.join(DOCS_PATH, file);
        let content = '';
        let fileType = '';

        if (file.endsWith('.md') || file.endsWith('.txt')) {
            content = fs.readFileSync(filePath, 'utf-8');
            fileType = 'Text';
        } else if (file.endsWith('.pdf')) {
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdf(dataBuffer);
            content = pdfData.text;
            fileType = 'PDF';
        }

        if (content) {
            console.log(`\n📄 Processing ${fileType} file: ${file}`);
            const chunks = chunkText(content);
            console.log(`- Split file into ${chunks.length} chunks.`);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embRes = await openai.embeddings.create({ model: "text-embedding-ada-002", input: chunk });
                const embedding = embRes.data[0].embedding;

                newDocs.push({
                    id: `doc:${file}-chunk:${i}`,
                    title: `DOC: ${file}`,
                    url: `local://${file}`,
                    content: chunk,
                    vector: embedding
                });
            }
            console.log(`- ✅ Prepared chunks for ${file}.`);
        }
    }

    if (newDocs.length > 0) {
        await table.add(newDocs);
        console.log(`\n➕ Adding ${newDocs.length} new document chunks to the database...`);
        console.log('✅ Successfully added documents.');
    } else {
        console.log('\n✨ No new documents to add.');
    }

    const finalCount = await table.countRows();
    console.log(`🏁 Ingestion complete. Vector DB now contains ${finalCount} total documents.`);
}

ingestDocs().catch((err) => {
  console.error("An unexpected error occurred during the document ingestion process:", err);
  process.exit(1);
});