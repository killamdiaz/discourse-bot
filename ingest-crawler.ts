// ingest-crawler.ts
import * as cheerio from 'cheerio';
import inquirer from 'inquirer';
import { connect, Table } from '@lancedb/lancedb';
import { OpenAI } from 'openai';
import puppeteer from 'puppeteer';
import { config } from './config.js'; // [cite: config.ts]
import { chunkText } from './lib/utils.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey }); // [cite: config.ts]

// --- Main Crawler Logic using Puppeteer ---
async function crawlAndIngest(startUrl: string, maxPages: number) {
    const queue: string[] = [startUrl];
    const visited = new Set<string>();
    const baseUrl = new URL(startUrl).origin;
    let pagesScraped = 0;

    const db = await connect(config.paths.lanceDb); // [cite: config.ts]
    let table: Table;

    // --- THIS IS THE FIX ---
    // Try to open the table, but if it fails, create it.
    try {
        table = await db.openTable('discourse_threads');
        console.log(`📚 Opened existing table "discourse_threads".`);
    } catch (e) {
        console.log('✨ Table "discourse_threads" not found, creating a new one...');
        const sampleData = [{
            id: '', title: '', url: '', content: '',
            vector: Array(1536).fill(0),
        }];
        table = await db.createTable('discourse_threads', sampleData);
        await table.delete("id = ''");
        console.log('✅ New table created successfully.');
    }
    // --- END OF FIX ---
    
    console.log(`🚀 Starting crawl from ${startUrl} (max ${maxPages} pages)`);
    console.log(`- Base URL identified as: ${baseUrl}`);

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }); // Added args for Linux compatibility

    while (queue.length > 0 && pagesScraped < maxPages) {
        const currentUrl = queue.shift()!;
        if (visited.has(currentUrl)) {
            continue;
        }

        console.log(`\n[${pagesScraped + 1}/${maxPages}] Scraping: ${currentUrl}`);
        visited.add(currentUrl);
        pagesScraped++;

        try {
            const page = await browser.newPage();
            await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            const html = await page.content();
            const $ = cheerio.load(html);

            $('a').each((_, element) => {
                const href = $(element).attr('href');
                if (href) {
                    try {
                      const fullUrl = new URL(href, baseUrl).href;
                      const urlWithoutAnchor = fullUrl.split('#')[0];
                      if (urlWithoutAnchor.startsWith(baseUrl) && !visited.has(urlWithoutAnchor) && !queue.includes(urlWithoutAnchor)) {
                          queue.push(urlWithoutAnchor);
                      }
                    } catch (e) { /* Ignore invalid URLs */ }
                }
            });

            $('script, style, nav, footer, header, form, button').remove();
            const pageTitle = $('title').text() || currentUrl;
            const text = $('body').text().replace(/\s\s+/g, ' ').trim();
            
            await page.close();

            if (!text) {
                console.log(`- ⚠️ No content found on page, skipping.`);
                continue;
            }
            console.log(`- Extracted ${text.length} characters.`);

            const chunks = chunkText(text);
            const newDocs = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embRes = await openai.embeddings.create({ model: "text-embedding-ada-002", input: chunk });
                
                newDocs.push({
                    id: `web:${currentUrl}-chunk:${i}`,
                    title: `WEB: ${pageTitle}`,
                    url: currentUrl,
                    content: chunk,
                    vector: embRes.data[0].embedding
                });
            }
            if (newDocs.length > 0) {
                await table.add(newDocs);
                console.log(`- ✅ Ingested ${newDocs.length} chunks from page.`);
            }

        } catch (error) {
            console.error(`- ❌ Failed to process ${currentUrl}:`, (error as Error).message);
        }
    }
    
    await browser.close();
    console.log(`\n🏁 Crawl complete. Visited ${pagesScraped} pages.`);
}

// --- Interactive Prompt Logic (unchanged) ---
async function main() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'url',
            message: 'Enter the starting URL for the documentation site:',
            validate: (input) => input.startsWith('http'),
        },
        {
            type: 'number',
            name: 'maxPages',
            message: 'How many pages should I scrape at most?',
            default: 10,
        }
    ]);

    if (answers.url && answers.maxPages) {
        await crawlAndIngest(answers.url, answers.maxPages);
    } else {
        console.log('Invalid input. Exiting.');
    }
}

main();