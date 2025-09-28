import * as cheerio from 'cheerio';
import inquirer from 'inquirer';
import { connect, Table } from '@lancedb/lancedb';
import { OpenAI } from 'openai';
import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from './config.js';
import { chunkText } from './lib/utils.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * A utility function to add a delay.
 * @param ms - The number of milliseconds to wait.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Crawler {
    private db: any;
    private table!: Table;
    private browser!: Browser;
    private queue: string[];
    private visited = new Set<string>();
    private readonly baseUrl: string;
    private readonly maxPages: number;
    private readonly delay: number;

    constructor(private startUrl: string, options: { maxPages?: number; delay?: number } = {}) {
        this.baseUrl = new URL(startUrl).origin;
        this.queue = [startUrl];
        this.maxPages = options.maxPages ?? 10;
        this.delay = options.delay ?? 500; // Default 500ms delay between requests
    }

    /**
     * Initializes the database connection and Puppeteer browser.
     */
    private async initialize() {
        console.log('🚀 Initializing crawler...');
        this.db = await connect(config.paths.lanceDb);
        this.table = await this.db.openTable('discourse_threads');
        this.browser = await puppeteer.launch({ headless: true });
        console.log(`- Base URL identified as: ${this.baseUrl}`);
        console.log(`- Max pages to scrape: ${this.maxPages}`);
        console.log(`- Delay between requests: ${this.delay}ms`);
    }

    /**
     * Shuts down the browser connection.
     */
    async shutdown() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    /**
     * Starts the crawling process.
     */
    async start() {
        await this.initialize();
        let pagesScraped = 0;

        while (this.queue.length > 0 && pagesScraped < this.maxPages) {
            const currentUrl = this.queue.shift()!;
            if (this.visited.has(currentUrl)) {
                continue;
            }

            console.log(`\n[${pagesScraped + 1}/${this.maxPages}] Scraping: ${currentUrl}`);
            this.visited.add(currentUrl);
            pagesScraped++;

            try {
                const page = await this.browser.newPage();

                // IMPROVED: Set a custom user agent for politeness
                await page.setUserAgent('AgentBrain-Crawler/1.0 (+https://your-contact-page.com)');
                
                await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 60000 });

                const content = await this.extractStructuredContent(page);
                
                if (!content || content.length < 100) {
                    console.log(`- ⚠️ Not enough meaningful content found, skipping.`);
                    await page.close();
                    continue;
                }
                
                console.log(`- Extracted ${content.length} characters of structured text.`);

                await this.discoverLinks(page);
                
                await page.close();

                await this.ingestContent(currentUrl, content);

            } catch (error) {
                console.error(`- ❌ Failed to process ${currentUrl}:`, (error as Error).message);
            }

            // IMPROVED: Add a delay to be a good web citizen and avoid rate limiting.
            await sleep(this.delay);
        }

        console.log(`\n🏁 Crawl complete. Visited ${pagesScraped} pages.`);
    }

    /**
     * Finds new, valid links on the page and adds them to the queue.
     */
    private async discoverLinks(page: Page) {
        const links = await page.$$eval('a', (anchors) =>
            anchors.map((a) => a.href)
        );

        for (const href of links) {
            if (href) {
                try {
                    const fullUrl = new URL(href, this.baseUrl).href;
                    const urlWithoutAnchor = fullUrl.split('#')[0];
                    if (
                        urlWithoutAnchor.startsWith(this.baseUrl) &&
                        !this.visited.has(urlWithoutAnchor) &&
                        !this.queue.includes(urlWithoutAnchor)
                    ) {
                        // A simple filter to avoid crawling non-document links
                        if (!/\.(jpg|jpeg|png|gif|svg|css|js|zip|pdf)$/i.test(urlWithoutAnchor)) {
                           this.queue.push(urlWithoutAnchor);
                        }
                    }
                } catch (e) {
                    // Ignore invalid URLs
                }
            }
        }
    }
    
    /**
     * Extracts content from the page, preserving semantic structure as Markdown.
     */
    private async extractStructuredContent(page: Page): Promise<string> {
        const html = await page.content();
        const $ = cheerio.load(html);

        // Remove elements that are typically not useful for content
        $('script, style, nav, footer, header, form, button, aside, [role="navigation"], [role="search"]').remove();

        let structuredText = '';

        // Iterate through main content elements to preserve structure
        $('body').find('h1, h2, h3, h4, p, li, pre, code, table').each((_, element) => {
            const $el = $(element);
            let content = '';

            switch (element.tagName) {
                case 'h1':
                    content = `# ${$el.text().trim()}\n\n`;
                    break;
                case 'h2':
                    content = `## ${$el.text().trim()}\n\n`;
                    break;
                case 'h3':
                    content = `### ${$el.text().trim()}\n\n`;
                    break;
                case 'h4':
                    content = `#### ${$el.text().trim()}\n\n`;
                    break;
                case 'p':
                    content = `${$el.text().trim()}\n\n`;
                    break;
                case 'li':
                    // Check parent to handle ordered vs unordered lists
                    const parentTag = $el.parent().get(0)?.tagName;
                    const prefix = parentTag === 'ol' ? '1.' : '-';
                    content = `${prefix} ${$el.text().trim()}\n`;
                    break;
                case 'pre':
                case 'code':
                     // Attempt to get language from class for syntax highlighting context
                    const lang = $el.attr('class')?.match(/language-(\w+)/)?.[1] || '';
                    content = "```" + lang + "\n" + $el.text().trim() + "\n```\n\n";
                    break;
                case 'table':
                    // Basic table to markdown conversion
                    let tableContent = '';
                    $el.find('tr').each((i, tr) => {
                        const row = $(tr).find('th, td').map((j, cell) => $(cell).text().trim()).get().join(' | ');
                        tableContent += `| ${row} |\n`;
                        if (i === 0) { // Add header separator
                            const separator = $(tr).find('th, td').map(() => '---').get().join(' | ');
                            tableContent += `| ${separator} |\n`;
                        }
                    });
                    content = tableContent + '\n';
                    break;
            }
            structuredText += content;
        });

        return structuredText.replace(/\n\n+/g, '\n\n').trim();
    }

    /**
     * Chunks the extracted content, generates embeddings, and adds it to LanceDB.
     */
    private async ingestContent(url: string, content: string) {
        const pageTitle = (await this.browser.pages().then(p => p[0].title())) || url;
        const chunks = chunkText(content, 1000, 200); // Using slightly larger chunks for structured text
        
        const newDocs = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            try {
                const embRes = await openai.embeddings.create({ model: "text-embedding-ada-002", input: chunk });
                
                newDocs.push({
                    id: `web:${url}-chunk:${i}`,
                    title: `WEB: ${pageTitle}`,
                    url: url, // This ensures the URL is saved for citation
                    content: chunk,
                    vector: embRes.data[0].embedding
                });
            } catch (embeddingError) {
                console.error(`- ❌ Failed to create embedding for chunk ${i} from ${url}:`, (embeddingError as Error).message);
            }
        }
        
        if (newDocs.length > 0) {
            await this.table.add(newDocs);
            console.log(`- ✅ Ingested ${newDocs.length} chunks from page.`);
        }
    }
}


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
            default: 20,
        }
    ]);

    if (answers.url && answers.maxPages) {
        const crawler = new Crawler(answers.url, { maxPages: answers.maxPages });
        try {
            await crawler.start();
        } catch(e) {
            console.error("A critical error occurred during the crawl:", e);
        } finally {
            await crawler.shutdown();
        }
    } else {
        console.log('Invalid input. Exiting.');
    }
}

main();