#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDB, importData } from '../db/index.js';
import type { ExportData } from '../db/BaseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'imghoster.db');
const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();

(async () => {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error('Usage: node scripts/db-restore.js <backup-path>');
    process.exit(1);
  }

  if (!fs.existsSync(backupPath)) {
    console.error(`Backup file not found: ${backupPath}`);
    process.exit(1);
  }

  try {
    if (DB_TYPE === 'sqlite') {
      if (backupPath.endsWith('.json')) {
        await initDB(DB_PATH);
        const data = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as ExportData;
        await importData(data);
        console.log(`Restored from JSON export into SQLite: ${DB_PATH}`);
        console.log(`   Users: ${data.users.length}, Images: ${data.images.length}`);
      } else {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.copyFileSync(backupPath, DB_PATH);
        for (const ext of ['-wal', '-shm']) {
          const f = DB_PATH + ext;
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }

        console.log(`SQLite database restored from: ${backupPath}`);
        console.log(`   Database: ${DB_PATH}`);
      }
    } else {
      const config = process.env.DATABASE_URL || DB_PATH;
      await initDB(config);

      const data = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as ExportData;
      if (!data.users || !data.images || !data.image_views) {
        throw new Error('Invalid backup format. Expected { users, images, image_views }.');
      }

      await importData(data);
      console.log(`Database restored from: ${backupPath}`);
      console.log(`   Users: ${data.users.length}`);
      console.log(`   Images: ${data.images.length}`);
      console.log(`   Views: ${data.image_views.length}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Restore failed:', (err as Error).message);
    process.exit(1);
  }
})();
