import Database from 'better-sqlite3';
import { config } from '../config.js';

// SQLite file
const dbPath = './data/bot_state.db';
let db: Database.Database;

/**
    Initializes the database connection and creates tables if they don't exist.
    This should be called once when the bot starts up.
 */
export function initializeDatabase() {
  db = new Database(dbPath);
  console.log(`[${config.bot.instanceId}] 🗄️  Connected to SQLite database at ${dbPath}`);

  // Create the table for replied posts if it's not already there.
  const createTableStmt = db.prepare(`
    CREATE TABLE IF NOT EXISTS replied_posts (
      id INTEGER PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  createTableStmt.run();
  console.log(`[${config.bot.instanceId}] - Table 'replied_posts' is ready.`);
}

/**
 * Loads all existing replied post IDs from the database into a Set.
 * @returns A Set containing all the post IDs from the database.
 */
export function loadRepliedIds(): Set<number> {
  const stmt = db.prepare('SELECT id FROM replied_posts');
  const rows = stmt.all() as { id: number }[];
  return new Set(rows.map(row => row.id));
}

/**
 * Adds a new post ID to the database.
 * This is an atomic operation and much safer than rewriting a JSON file.
 * @param postId The ID of the post to add.
 */
export function addRepliedId(postId: number) {
  const stmt = db.prepare('INSERT OR IGNORE INTO replied_posts (id) VALUES (?)');
  stmt.run(postId);
}