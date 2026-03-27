/**
 * Automated backup scheduler.
 *
 * Runs database backups on a configurable interval (default: daily).
 * Configuration is read from environment or updated at runtime via the admin API.
 *
 * Environment variables:
 *   BACKUP_ENABLED      – 'true' to enable (default: 'false')
 *   BACKUP_INTERVAL_MS  – interval in milliseconds (default: 86400000 = 24h)
 *   BACKUP_DIR          – directory to store backups (default: ./data/backups)
 *   BACKUP_RETAIN_COUNT – max number of backups to keep (default: 7)
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportData, getDB } from '../db/index.js';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_RETAIN_COUNT = 7;
const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

let timer = null;
let config = {
  enabled: (process.env.BACKUP_ENABLED || 'false') === 'true',
  intervalMs: Number(process.env.BACKUP_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
  backupDir: process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR,
  retainCount: Number(process.env.BACKUP_RETAIN_COUNT) || DEFAULT_RETAIN_COUNT,
  lastBackupAt: null,
  lastBackupPath: null,
  lastError: null,
};

/**
 * Run a single backup.
 */
async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();

  if (!fs.existsSync(config.backupDir)) {
    fs.mkdirSync(config.backupDir, { recursive: true });
  }

  try {
    let outPath;

    if (dbType === 'sqlite') {
      outPath = path.join(config.backupDir, `backup_${timestamp}.db`);
      const adapter = getDB();
      const rawDb = adapter.getRawDB();
      await rawDb.backup(outPath);
    } else {
      outPath = path.join(config.backupDir, `backup_${timestamp}.json`);
      const data = await exportData();
      fs.writeFileSync(outPath, JSON.stringify(data));
    }

    config.lastBackupAt = new Date().toISOString();
    config.lastBackupPath = outPath;
    config.lastError = null;

    const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
    logger.info('Automated backup completed', { path: outPath, sizeKB });

    // Prune old backups
    pruneOldBackups();

    return { success: true, path: outPath, sizeKB };
  } catch (err) {
    config.lastError = err.message;
    logger.error('Automated backup failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Remove old backups beyond the retention count.
 */
function pruneOldBackups() {
  try {
    if (!fs.existsSync(config.backupDir)) return;

    const files = fs.readdirSync(config.backupDir)
      .filter(f => f.startsWith('backup_'))
      .sort()
      .reverse(); // newest first

    const toDelete = files.slice(config.retainCount);
    for (const file of toDelete) {
      fs.unlinkSync(path.join(config.backupDir, file));
      logger.info('Pruned old backup', { file });
    }
  } catch (err) {
    logger.warn('Backup pruning error', { error: err.message });
  }
}

/**
 * Start the backup scheduler.
 */
function startScheduler() {
  stopScheduler();
  if (!config.enabled) return;

  timer = setInterval(runBackup, config.intervalMs);
  if (timer.unref) timer.unref();
  logger.info('Backup scheduler started', {
    intervalMs: config.intervalMs,
    retainCount: config.retainCount,
    backupDir: config.backupDir,
  });
}

/**
 * Stop the backup scheduler.
 */
function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Get the current scheduler configuration and status.
 */
function getSchedulerStatus() {
  return {
    enabled: config.enabled,
    intervalMs: config.intervalMs,
    intervalHuman: `${(config.intervalMs / 3600000).toFixed(1)}h`,
    backupDir: config.backupDir,
    retainCount: config.retainCount,
    running: timer !== null,
    lastBackupAt: config.lastBackupAt,
    lastBackupPath: config.lastBackupPath,
    lastError: config.lastError,
  };
}

/**
 * Update the scheduler configuration. Restarts the scheduler if running.
 */
function updateSchedulerConfig(updates) {
  if (updates.enabled !== undefined) config.enabled = updates.enabled;
  if (updates.intervalMs !== undefined) config.intervalMs = Math.max(60000, Number(updates.intervalMs)); // min 1 minute
  if (updates.retainCount !== undefined) config.retainCount = Math.max(1, Number(updates.retainCount));
  if (updates.backupDir !== undefined) config.backupDir = String(updates.backupDir);

  // Restart scheduler with new config
  if (config.enabled) {
    startScheduler();
  } else {
    stopScheduler();
  }

  return getSchedulerStatus();
}

export {
  runBackup,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  updateSchedulerConfig,
};
