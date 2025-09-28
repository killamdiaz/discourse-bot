import { connect } from '@lancedb/lancedb';
import { config } from './config.js';

async function removeWebDocs() {
  console.log('🚀 Starting removal process for web-scraped documents...');

  try {
    const db = await connect(config.paths.lanceDb);
    const table = await db.openTable('discourse_threads');

    const countBefore = await table.countRows();
    console.log(`- 📊 Vector DB contains ${countBefore} documents before deletion.`);

    // Target the unique ID format we created in ingest-crawler.ts
    await table.delete("id LIKE 'web:%'");
    
    console.log('✅ Successfully sent delete command for all documents with ID starting with "web:".');

    const countAfter = await table.countRows();
    console.log(`- 📊 Vector DB now contains ${countAfter} documents.`);
    console.log(`🏁 Removal complete. ${countAfter - countBefore} documents were removed.`);

  } catch (error) {
    console.error('❌ An error occurred during the removal process:', error);
    process.exit(1);
  }
}

removeWebDocs();
