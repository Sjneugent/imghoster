#!/usr/bin/env node
'use strict';

/**
 * Database backup script.
 *
 * For SQLite:  copies the database file (using the online backup API).
 * For PostgreSQL:  exports all data to a JSON file.
 *
 * Usage:
 *   node scripts/db-backup.js [output-path]
 *
 * Examples:
 *   node scripts/db-backup.js                          # auto-named backup
 *   node scripts/db-backup.js ./backups/mybackup.db    # custom path (SQLite)
 *   node scripts/db-backup.js ./backups/export.json    # custom path (PostgreSQL)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const { initDB, exportData } = require('../db');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'imghoster.db');
const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();

(async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    if (DB_TYPE === 'sqlite') {
      await initDB(DB_PATH);
      const defaultOut = path.join(
        path.dirname(DB_PATH),
        `backup_${timestamp}.db`
      );
      const outPath = process.argv[2] || defaultOut;
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      // Use better-sqlite3's backup API for a consistent online backup
      const adapter = require('../db').getDB();
      const rawDb = adapter.getRawDB();
      await rawDb.backup(outPath);

      console.log(`✅ SQLite backup saved to: ${outPath}`);
      console.log(`   Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
    } else {
      // For non-SQLite databases, export data as JSON
      const config = process.env.DATABASE_URL || DB_PATH;
      await initDB(config);

      const defaultOut = path.join(
        __dirname, '..', 'data',
        `backup_${timestamp}.json`
      );
      const outPath = process.argv[2] || defaultOut;
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const data = await exportData();
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

      console.log(`✅ Database export saved to: ${outPath}`);
      console.log(`   Users: ${data.users.length}`);
      console.log(`   Images: ${data.images.length}`);
      console.log(`   Views: ${data.image_views.length}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Backup failed:', err.message);
    process.exit(1);
  }
})();
