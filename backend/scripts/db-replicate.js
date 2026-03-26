#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import SqliteAdapter from '../db/adapters/sqlite.js';
import PostgresAdapter from '../db/adapters/postgresql.js';

/**
 * Database replication / migration script.
 *
 * Exports data from one database and imports it into another.
 * Supports cross-database-type migration (e.g. SQLite → PostgreSQL).
 *
 * Usage:
 *   node scripts/db-replicate.js --export [output.json]
 *   node scripts/db-replicate.js --import <input.json>
 *   node scripts/db-replicate.js --migrate
 *
 * The --migrate flag reads source config from SOURCE_DB_TYPE / SOURCE_DB_PATH
 * / SOURCE_DATABASE_URL and writes to DB_TYPE / DB_PATH / DATABASE_URL.
 *
 * Examples:
 *   # Export current database to JSON
 *   node scripts/db-replicate.js --export ./data/export.json
 *
 *   # Import JSON into current database
 *   node scripts/db-replicate.js --import ./data/export.json
 *
 *   # Migrate from SQLite to PostgreSQL
 *   SOURCE_DB_TYPE=sqlite SOURCE_DB_PATH=./data/imghoster.db \
 *   DB_TYPE=postgresql DATABASE_URL=postgres://localhost/imghoster \
 *   node scripts/db-replicate.js --migrate
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'imghoster.db');

function createAdapter(dbType, config) {
  const type = (dbType || 'sqlite').toLowerCase();
  switch (type) {
    case 'sqlite': {
      return new SqliteAdapter();
    }
    case 'postgresql':
    case 'postgres':
    case 'pg': {
      return new PostgresAdapter();
    }
    default:
      throw new Error(`Unsupported DB_TYPE: "${type}"`);
  }
}

async function doExport() {
  const outPath = process.argv[3] || path.join(__dirname, '..', 'data', 'export.json');
  const dbType = process.env.DB_TYPE || 'sqlite';
  const config = dbType === 'sqlite'
    ? DB_PATH
    : (process.env.DATABASE_URL || DB_PATH);

  const adapter = createAdapter(dbType);
  await adapter.init(config);

  const data = await adapter.exportData();
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  await adapter.close();

  console.log(`✅ Exported to: ${outPath}`);
  console.log(`   Users: ${data.users.length}`);
  console.log(`   Images: ${data.images.length}`);
  console.log(`   Views: ${data.image_views.length}`);
}

async function doImport() {
  const inPath = process.argv[3];
  if (!inPath) {
    console.error('Usage: node scripts/db-replicate.js --import <input.json>');
    process.exit(1);
  }
  if (!fs.existsSync(inPath)) {
    console.error(`❌ File not found: ${inPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  if (!data.users || !data.images || !data.image_views) {
    console.error('❌ Invalid format. Expected { users, images, image_views }.');
    process.exit(1);
  }

  const dbType = process.env.DB_TYPE || 'sqlite';
  const config = dbType === 'sqlite'
    ? DB_PATH
    : (process.env.DATABASE_URL || DB_PATH);

  const adapter = createAdapter(dbType);
  await adapter.init(config);
  await adapter.importData(data);
  await adapter.close();

  console.log(`✅ Imported from: ${inPath}`);
  console.log(`   Users: ${data.users.length}`);
  console.log(`   Images: ${data.images.length}`);
  console.log(`   Views: ${data.image_views.length}`);
}

async function doMigrate() {
  const srcType = process.env.SOURCE_DB_TYPE || 'sqlite';
  const srcConfig = srcType === 'sqlite'
    ? (process.env.SOURCE_DB_PATH || DB_PATH)
    : (process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL);

  const dstType = process.env.DB_TYPE || 'sqlite';
  const dstConfig = dstType === 'sqlite'
    ? DB_PATH
    : (process.env.DATABASE_URL || DB_PATH);

  if (srcType === dstType && srcConfig === dstConfig) {
    console.error('❌ Source and destination are the same. Set SOURCE_DB_TYPE/SOURCE_DB_PATH.');
    process.exit(1);
  }

  console.log(`Migrating: ${srcType} → ${dstType}`);

  // Export from source
  const srcAdapter = createAdapter(srcType);
  await srcAdapter.init(srcConfig);
  const data = await srcAdapter.exportData();
  await srcAdapter.close();

  console.log(`   Exported ${data.users.length} users, ${data.images.length} images, ${data.image_views.length} views`);

  // Import into destination
  const dstAdapter = createAdapter(dstType);
  await dstAdapter.init(dstConfig);
  await dstAdapter.importData(data);
  await dstAdapter.close();

  console.log('✅ Migration complete!');
  console.log('   Note: uploaded image files are NOT copied. Ensure the uploads/ directory');
  console.log('   is accessible by the new database server.');
}

(async () => {
  try {
    const command = process.argv[2];

    switch (command) {
      case '--export':
        await doExport();
        break;
      case '--import':
        await doImport();
        break;
      case '--migrate':
        await doMigrate();
        break;
      default:
        console.log('Database replication / migration tool');
        console.log('');
        console.log('Usage:');
        console.log('  node scripts/db-replicate.js --export [output.json]');
        console.log('  node scripts/db-replicate.js --import <input.json>');
        console.log('  node scripts/db-replicate.js --migrate');
        console.log('');
        console.log('The --migrate flag reads source config from SOURCE_DB_TYPE /');
        console.log('SOURCE_DB_PATH / SOURCE_DATABASE_URL and writes to the current');
        console.log('DB_TYPE / DB_PATH / DATABASE_URL configuration.');
        process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Operation failed:', err.message);
    process.exit(1);
  }
})();
