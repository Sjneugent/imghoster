#!/usr/bin/env node

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, getDB, upsertImageBlob, getImageBlobByImageId } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'imghoster.db');
const DEFAULT_UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
const DEFAULT_CHECKPOINT_PATH =
  process.env.BLOB_MIGRATION_CHECKPOINT || path.join(__dirname, '..', 'data', 'blob-migration-checkpoint.json');

function getArgValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function parseArgs(argv) {
  return {
    verify: !argv.includes('--no-verify'),
    verifyOnly: argv.includes('--verify-only'),
    deleteFiles: argv.includes('--delete-files'),
    dryRun: argv.includes('--dry-run'),
    checkpointPath: getArgValue(argv, '--checkpoint') || DEFAULT_CHECKPOINT_PATH,
    noResume: argv.includes('--no-resume'),
    fromStart: argv.includes('--from-start'),
    clearCheckpoint: argv.includes('--clear-checkpoint'),
  };
}

function getRowsForMode(rawDb, verifyOnly, resumeAfterId = 0) {
  if (verifyOnly) {
    return rawDb.prepare(
      `SELECT id, filename, slug, size, storage_backend
       FROM images
       WHERE COALESCE(storage_backend, 'file') IN ('file', 'db_blob')
       ORDER BY id`
    ).all();
  }

  return rawDb.prepare(
    `SELECT id, filename, slug, size, storage_backend
     FROM images
     WHERE COALESCE(storage_backend, 'file') = 'file'
       AND id > ?
     ORDER BY id`
  ).all(resumeAfterId);
}

function readCheckpoint(checkpointPath) {
  try {
    if (!fs.existsSync(checkpointPath)) return { lastMigratedImageId: 0 };
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    return {
      lastMigratedImageId: Number(parsed.lastMigratedImageId) || 0,
      updatedAt: parsed.updatedAt || null,
    };
  } catch (_err) {
    return { lastMigratedImageId: 0 };
  }
}

function writeCheckpoint(checkpointPath, payload) {
  const dir = path.dirname(checkpointPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${checkpointPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, checkpointPath);
}

export async function migrateFileStorageToBlobs(options = {}) {
  const {
    dbPath = DEFAULT_DB_PATH,
    uploadsDir = DEFAULT_UPLOADS_DIR,
    verify = true,
    verifyOnly = false,
    dryRun = false,
    deleteFiles = false,
    checkpointPath = DEFAULT_CHECKPOINT_PATH,
    resume = true,
    maxMigrations = Number.POSITIVE_INFINITY,
    closeWhenDone = false,
    log = () => {},
  } = options;

  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
  if (dbType !== 'sqlite') {
    throw new Error('storage-migrate-to-blobs currently supports DB_TYPE=sqlite only.');
  }

  await initDB(dbPath);
  const adapter = getDB();

  if (typeof adapter.getRawDB !== 'function') {
    throw new Error('Active adapter does not expose getRawDB().');
  }

  const rawDb = adapter.getRawDB();
  const checkpoint = resume && !verifyOnly && !dryRun
    ? readCheckpoint(checkpointPath)
    : { lastMigratedImageId: 0 };
  const rows = getRowsForMode(rawDb, verifyOnly, checkpoint.lastMigratedImageId);

  const summary = {
    scanned: rows.length,
    resumedFromId: checkpoint.lastMigratedImageId,
    checkpointPath,
    migrated: 0,
    verified: 0,
    missingFiles: 0,
    mismatchedBytes: 0,
    failures: 0,
    deletedFiles: 0,
    migratedIds: [],
  };

  for (const row of rows) {
    const filePath = path.join(uploadsDir, row.filename);

    if (!fs.existsSync(filePath)) {
      summary.missingFiles += 1;
      log(`[missing] ${row.slug} -> ${filePath}`);
      continue;
    }

    let bytes;
    try {
      bytes = fs.readFileSync(filePath);
    } catch (err) {
      summary.failures += 1;
      log(`[read-failed] ${row.slug}: ${err.message}`);
      continue;
    }

    if (Number.isInteger(row.size) && row.size !== bytes.length) {
      summary.mismatchedBytes += 1;
      log(`[size-mismatch] ${row.slug}: db=${row.size} file=${bytes.length}`);
    }

    const shouldMigrate = row.storage_backend !== 'db_blob' && !verifyOnly && !dryRun;

    if (shouldMigrate) {
      try {
        await upsertImageBlob(row.id, bytes);
        rawDb.prepare("UPDATE images SET storage_backend = 'db_blob', size = ? WHERE id = ?")
          .run(bytes.length, row.id);
        summary.migrated += 1;
        summary.migratedIds.push(row.id);

        if (resume) {
          writeCheckpoint(checkpointPath, {
            lastMigratedImageId: row.id,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        summary.failures += 1;
        log(`[migrate-failed] ${row.slug}: ${err.message}`);
        continue;
      }
    }

    if (verify) {
      try {
        const blobRow = await getImageBlobByImageId(row.id);
        if (!blobRow || !blobRow.blob_data) {
          summary.failures += 1;
          log(`[verify-failed] ${row.slug}: blob row missing`);
          continue;
        }
        const blobBytes = Buffer.from(blobRow.blob_data);
        if (Buffer.compare(blobBytes, bytes) !== 0) {
          summary.failures += 1;
          log(`[verify-failed] ${row.slug}: byte mismatch`);
          continue;
        }
        summary.verified += 1;
      } catch (err) {
        summary.failures += 1;
        log(`[verify-error] ${row.slug}: ${err.message}`);
        continue;
      }
    }

    if (deleteFiles && !verifyOnly && !dryRun) {
      try {
        fs.unlinkSync(filePath);
        summary.deletedFiles += 1;
      } catch (err) {
        summary.failures += 1;
        log(`[delete-failed] ${row.slug}: ${err.message}`);
      }
    }

    if (summary.migrated >= maxMigrations) {
      break;
    }
  }

  if (closeWhenDone && typeof adapter.close === 'function') {
    await adapter.close();
  }

  return summary;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));

  if (args.clearCheckpoint) {
    if (fs.existsSync(args.checkpointPath)) {
      fs.unlinkSync(args.checkpointPath);
      console.log(`Removed checkpoint: ${args.checkpointPath}`);
    } else {
      console.log(`No checkpoint file at: ${args.checkpointPath}`);
    }
    process.exit(0);
  }

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Migrate file-backed images to DB blobs (SQLite)');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/storage-migrate-to-blobs.js');
    console.log('  node scripts/storage-migrate-to-blobs.js --verify-only');
    console.log('  node scripts/storage-migrate-to-blobs.js --dry-run');
    console.log('  node scripts/storage-migrate-to-blobs.js --delete-files');
    console.log('');
    console.log('Flags:');
    console.log('  --verify-only   Do not migrate, just verify existing blob records vs files');
    console.log('  --no-verify     Skip byte-by-byte verification pass');
    console.log('  --dry-run       Scan and report but do not write blobs or update rows');
    console.log('  --delete-files  Remove legacy files only after successful migration+verification');
    console.log('  --checkpoint    Path to checkpoint file (default backend/data/blob-migration-checkpoint.json)');
    console.log('  --no-resume     Ignore checkpoint state and process from image id 0');
    console.log('  --from-start    Alias of --no-resume');
    console.log('  --clear-checkpoint  Remove checkpoint file and exit');
    process.exit(0);
  }

  const summary = await migrateFileStorageToBlobs({
    verify: args.verify,
    verifyOnly: args.verifyOnly,
    dryRun: args.dryRun,
    deleteFiles: args.deleteFiles,
    checkpointPath: args.checkpointPath,
    resume: !(args.noResume || args.fromStart),
    closeWhenDone: true,
    log: (line) => console.log(line),
  });

  console.log('');
  console.log('Migration summary');
  console.log(`  scanned:        ${summary.scanned}`);
  console.log(`  resumed from:   ${summary.resumedFromId}`);
  console.log(`  checkpoint:     ${summary.checkpointPath}`);
  console.log(`  migrated:       ${summary.migrated}`);
  console.log(`  verified:       ${summary.verified}`);
  console.log(`  missing files:  ${summary.missingFiles}`);
  console.log(`  size mismatch:  ${summary.mismatchedBytes}`);
  console.log(`  deleted files:  ${summary.deletedFiles}`);
  console.log(`  failures:       ${summary.failures}`);

  if (summary.failures > 0) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  runCli().catch((err) => {
    console.error(`Migration failed: ${err.message}`);
    process.exit(1);
  });
}
