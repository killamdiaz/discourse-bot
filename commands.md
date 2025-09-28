Bot Commands & Operations Manual
This document outlines all the necessary commands to set up, run, manage, and interact with the AI Support Bot.
1. Running the Bot
These are the primary commands for starting the bot's services.
Start the Discord Bot
This command starts the main bot process. It will connect to Discord and begin listening for ticket creations, forum posts, and messages. You must leave this terminal running for the bot to stay online.
npm run start:discord



Build the Project
Run this command after any changes to the TypeScript (.ts) files to compile them into JavaScript that can be executed.
npm run build



2. Knowledge Base Management
Use these commands to add or remove information from the bot's brain (the vector database).
Ingest from Local Files
Reads all .md, .txt, and .pdf files from the /knowledge_base folder and adds them to the bot's memory.
npm run ingest:docs



Ingest from a Single Web Page
Prompts you for a URL, then scrapes the content from that single page and adds it to the bot's memory.
npm run ingest:web



Crawl an Entire Website
Prompts you for a starting URL and a page limit. It will then crawl the website, scraping and ingesting content from multiple pages until it reaches the limit.
npm run ingest:crawl



Remove Knowledge from Local Files
Deletes all information that was ingested from the /knowledge_base folder.
npm run remove:docs



Remove Knowledge from Web Scrapes
Deletes all information that was ingested from the single-page scraper or the website crawler.
npm run remove:web



3. Discord Interaction Commands
These commands are used within the Discord client itself.
/close
This slash command can be used inside any ticket (private thread) or public support post.
Action: Closes and archives the thread, preventing further messages.
Permissions: Can only be used by the original poster of the ticket or a user with the "Support Team" role.
4. One-Time Setup Commands
These commands typically only need to be run once when you first set up the bot in a new server.
Deploy Discord Commands
Registers all slash commands (like /close) with Discord. You only need to run this again if you add new slash commands in the future.
npm run deploy:commands



Post the "Create Ticket" Button
Posts the embedded message with the "Create Ticket" button in the channel specified by DISCORD_TICKET_CHANNEL_ID in your .env file. If you run it again, it will delete the old message and post a new one.
npm run setup:discord



