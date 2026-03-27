#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, listUsers, getImageStats } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'imghoster.db');
const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();

async function showStatus(): Promise<void> {
  const config = DB_TYPE === 'sqlite'
    ? DB_PATH
    : (process.env.DATABASE_URL || DB_PATH);

  await initDB(config);

  const users = await listUsers();
  const stats = await getImageStats(null);

  const totalViews = stats.reduce((sum, s) => sum + (s.view_count || 0), 0);

  console.log('Database status');
  console.log(`   Type:    ${DB_TYPE}`);
  console.log(`   Config:  ${DB_TYPE === 'sqlite' ? DB_PATH : '(connection string)'}`);
  console.log(`   Users:   ${users.length}`);
  console.log(`   Images:  ${stats.length}`);
  console.log(`   Views:   ${totalViews}`);
  console.log('');

  if (users.length > 0) {
    console.log('   Users:');
    for (const u of users) {
      console.log(`     - ${u.username} (${u.is_admin ? 'admin' : 'user'}) created ${u.created_at}`);
    }
  }
}

async function reinit(): Promise<void> {
  const config = DB_TYPE === 'sqlite'
    ? DB_PATH
    : (process.env.DATABASE_URL || DB_PATH);

  console.log(`Initialising ${DB_TYPE} database...`);
  await initDB(config);
  console.log('Database schema is up-to-date.');
}

(async () => {
  try {
    const command = process.argv[2];

    switch (command) {
      case '--status':
        await showStatus();
        break;
      case '--reinit':
        await reinit();
        break;
      default:
        console.log('Database migration / management tool');
        console.log('');
        console.log('Usage:');
        console.log('  node scripts/db-migrate.js --status    Show database status');
        console.log('  node scripts/db-migrate.js --reinit    Re-initialise schema');
        console.log('');
        console.log('Environment variables:');
        console.log('  DB_TYPE        Database type: sqlite (default), postgresql');
        console.log('  DB_PATH        SQLite file path (default: ./data/imghoster.db)');
        console.log('  DATABASE_URL   PostgreSQL connection string');
        process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('Operation failed:', (err as Error).message);
    process.exit(1);
  }
})();
