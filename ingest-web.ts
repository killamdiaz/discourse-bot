import axios from 'axios';
import * as cheerio from 'cheerio';
import inquirer from 'inquirer';
import { connect } from '@lancedb/lancedb';
import { OpenAI } from 'openai';
import { config } from './config.js';
import { chunkText } from './lib/utils.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey }); //

async function scrapeAndIngest(url: string) {
    try {
        console.log(`\n scraping ${url}...`);
        const response = await axios.get(url);
        const html = response.data;

        const $ = cheerio.load(html);
        const pageTitle = $('title').text() || url;
        
        $('script, style, nav, footer, header, form, button').remove();
        
        let text = $('body').text();
        
        text = text.replace(/\s\s+/g, ' ').trim();

        if (!text) {
            console.error('❌ No content found on the page after cleaning.');
            return;
        }

        console.log(`- ✅ Extracted ${text.length} characters of text from the page.`);

        const chunks = chunkText(text);
        console.log(`- Split content into ${chunks.length} chunks.`);

        const newDocs = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embRes = await openai.embeddings.create({ model: "text-embedding-ada-002", input: chunk });
            const embedding = embRes.data[0].embedding;
            
            newDocs.push({
                id: `web:${url}-chunk:${i}`,
                title: `WEB: ${pageTitle}`,
                url: url,
                content: chunk,
                vector: embedding
            });
        }
        console.log(`- ✅ Prepared ${newDocs.length} chunks for ingestion.`);
        
        const db = await connect(config.paths.lanceDb); 
        const table = await db.openTable('discourse_threads');
        await table.add(newDocs);

        console.log(`\n➕ Successfully added ${newDocs.length} chunks from ${url} to the database.`);
    } catch (error) {
        console.error(`❌ Failed to scrape or ingest the URL:`, error);
    }
}

async function main() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'url',
            message: 'Please enter the full URL of the documentation page you want to scrape:',
        }
    ]);

    if (answers.url) {
        await scrapeAndIngest(answers.url);
    } else {
        console.log('No URL provided. Exiting.');
    }
}

main();