import { connect } from '@lancedb/lancedb';
import { config } from './config.js'; //

async function removeDocs() {
  console.log('🚀 Starting removal process for ingested documents...');

  try {
    const db = await connect(config.paths.lanceDb); //
    const table = await db.openTable('discourse_threads');

    const countBefore = await table.countRows();
    console.log(`- 📊 Vector DB contains ${countBefore} documents before deletion.`);

    await table.delete("id LIKE 'doc:%'");
    
    console.log('✅ Successfully sent delete command for all documents with ID starting with "doc:".');

    const countAfter = await table.countRows();
    console.log(`- 📊 Vector DB now contains ${countAfter} documents.`);
    console.log(`🏁 Removal complete. ${countBefore - countAfter} documents were removed.`);

  } catch (error) {
    console.error('❌ An error occurred during the removal process:', error);
    process.exit(1);
  }
}

removeDocs();