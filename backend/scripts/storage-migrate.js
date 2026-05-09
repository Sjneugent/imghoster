/**
 * storage-migrate.ts – migrate images between storage providers.
 *
 * Usage:
 *   npm run storage:migrate   – migrate all images from current provider to a target provider
 *   npm run storage:verify    – verify every DB image record has a corresponding storage object
 *   npm run storage:sync      – sync any images missing from the secondary provider (replication gap)
 *
 * Extra env vars (on top of normal server env):
 *   STORAGE_MIGRATE_TARGET    – target STORAGE_PROVIDER value (overrides STORAGE_PROVIDER for the destination)
 *   STORAGE_MIGRATE_RESUME    – set to "true" to skip keys already present in target (default: true)
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, listAllImages } from '../db/index.js';
import { createStorageProvider } from '../storage/StorageProviderFactory.js';
import logger from '../logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'imghoster.db');
const args = process.argv.slice(2);
const VERIFY_ONLY = args.includes('--verify-only');
const SYNC_MISSING = args.includes('--sync-missing');
const RESUME = process.env.STORAGE_MIGRATE_RESUME !== 'false';
async function main() {
    await initDB(DB_PATH);
    // Source provider: current STORAGE_PROVIDER (or IMAGE_STORAGE_MODE fallback)
    const source = await createStorageProvider();
    const images = await listAllImages();
    logger.info(`Found ${images.length} images in database.`);
    if (VERIFY_ONLY) {
        let missing = 0;
        for (const img of images) {
            const found = await source.exists(img.filename);
            if (!found) {
                logger.warn('Image MISSING from storage', { id: img.id, slug: img.slug, filename: img.filename });
                missing++;
            }
        }
        logger.info(`Verify complete: ${missing} missing / ${images.length} total.`);
        await source.close();
        return;
    }
    // Destination provider: STORAGE_MIGRATE_TARGET or prompted to set it
    const targetProvider = process.env.STORAGE_MIGRATE_TARGET;
    if (!targetProvider) {
        logger.error('Set STORAGE_MIGRATE_TARGET to the destination provider name (e.g. s3, local, dbblob).');
        process.exit(1);
    }
    const target = await createStorageProvider({ provider: targetProvider });
    logger.info(`Migrating from "${source.name}" → "${target.name}" (${images.length} images).`);
    let copied = 0;
    let skipped = 0;
    let failed = 0;
    for (const img of images) {
        try {
            if (RESUME && await target.exists(img.filename)) {
                skipped++;
                continue;
            }
            const data = await source.get(img.filename);
            await target.put(img.filename, data, img.mime_type);
            copied++;
            if (copied % 100 === 0) {
                logger.info(`Progress: ${copied} copied, ${skipped} skipped, ${failed} failed`);
            }
        }
        catch (err) {
            failed++;
            logger.error('Failed to migrate image', {
                id: img.id,
                filename: img.filename,
                error: err.message,
            });
        }
    }
    logger.info(`Migration complete: ${copied} copied, ${skipped} skipped, ${failed} failed.`);
    if (SYNC_MISSING) {
        logger.info('Sync-missing mode: checking target for additional objects...');
        let synced = 0;
        for await (const key of source.list()) {
            const found = await target.exists(key);
            if (!found) {
                try {
                    const data = await source.get(key);
                    // Guess content type from extension
                    const ext = key.split('.').pop()?.toLowerCase() ?? '';
                    const mime = {
                        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
                    };
                    await target.put(key, data, mime[ext] ?? 'application/octet-stream');
                    synced++;
                }
                catch (err) {
                    logger.error('Failed to sync object', { key, error: err.message });
                }
            }
        }
        logger.info(`Sync complete: ${synced} extra objects synced.`);
    }
    await Promise.all([source.close(), target.close()]);
}
main().catch((err) => {
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    process.exit(1);
});
//# sourceMappingURL=storage-migrate.js.map