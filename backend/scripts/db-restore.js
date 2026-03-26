#!/usr/bin/env node
'use strict';

/**
 * Database restore script.
 *
 * For SQLite:  replaces the current database file with a backup copy.
 * For PostgreSQL:  imports data from a JSON export.
 *
 * Usage:
 *   node scripts/db-restore.js <backup-path>
 *
 * Examples:
 *   node scripts/db-restore.js ./backups/backup_2024-01-15.db
 *   node scripts/db-restore.js ./backups/export.json
 *
 * ⚠️  WARNING: This will OVERWRITE the current database.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const { initDB, importData } = require('../db');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'imghoster.db');
const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();

(async () => {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error('Usage: node scripts/db-restore.js <backup-path>');
    process.exit(1);
  }

  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Backup file not found: ${backupPath}`);
    process.exit(1);
  }

  try {
    if (DB_TYPE === 'sqlite') {
      if (backupPath.endsWith('.json')) {
        // Restore from JSON export into SQLite
        await initDB(DB_PATH);
        const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        await importData(data);
        console.log(`✅ Restored from JSON export into SQLite: ${DB_PATH}`);
        console.log(`   Users: ${data.users.length}, Images: ${data.images.length}`);
      } else {
        // Direct file copy restore
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.copyFileSync(backupPath, DB_PATH);
        // Remove WAL/SHM files if they exist (they're stale after restore)
        for (const ext of ['-wal', '-shm']) {
          const f = DB_PATH + ext;
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }

        console.log(`✅ SQLite database restored from: ${backupPath}`);
        console.log(`   Database: ${DB_PATH}`);
      }
    } else {
      // PostgreSQL: import from JSON
      const config = process.env.DATABASE_URL || DB_PATH;
      await initDB(config);

      const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      if (!data.users || !data.images || !data.image_views) {
        throw new Error('Invalid backup format. Expected { users, images, image_views }.');
      }

      await importData(data);
      console.log(`✅ Database restored from: ${backupPath}`);
      console.log(`   Users: ${data.users.length}`);
      console.log(`   Images: ${data.images.length}`);
      console.log(`   Views: ${data.image_views.length}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Restore failed:', err.message);
    process.exit(1);
  }
})();
