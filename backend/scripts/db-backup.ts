#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDB, exportData, getDB } from '../db/index.js';
import type { ExportData } from '../db/BaseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

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

      const adapter = getDB();
      const rawDb = (adapter as unknown as { getRawDB(): { backup(dest: string): void } }).getRawDB();
      rawDb.backup(outPath);

      console.log(`SQLite backup saved to: ${outPath}`);
      console.log(`   Size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
    } else {
      const config = process.env.DATABASE_URL || DB_PATH;
      await initDB(config);

      const defaultOut = path.join(
        __dirname, '..', 'data',
        `backup_${timestamp}.json`
      );
      const outPath = process.argv[2] || defaultOut;
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const data: ExportData = await exportData();
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

      console.log(`Database export saved to: ${outPath}`);
      console.log(`   Users: ${data.users.length}`);
      console.log(`   Images: ${data.images.length}`);
      console.log(`   Views: ${data.image_views.length}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Backup failed:', (err as Error).message);
    process.exit(1);
  }
})();
