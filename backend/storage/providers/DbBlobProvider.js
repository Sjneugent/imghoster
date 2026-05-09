import BaseStorageProvider from '../BaseStorageProvider.js';
import { getDB } from '../../db/index.js';
/**
 * DbBlobProvider – stores image bytes in the database's `storage_objects` table.
 *
 * This preserves backward-compatibility with `IMAGE_STORAGE_MODE=dbblob` while
 * integrating cleanly with the storage provider abstraction.  No cloud credentials
 * or external services are required.
 */
class DbBlobProvider extends BaseStorageProvider {
    name = 'dbblob';
    async init(_config) {
        // The DB adapter is expected to already be initialized before the storage
        // provider is created.  Calling getDB() here validates that.
        getDB();
        return this;
    }
    async put(key, data, contentType) {
        await getDB().putStorageObject(key, data, contentType);
    }
    async get(key) {
        const row = await getDB().getStorageObject(key);
        if (!row || !row.blob_data) {
            throw new Error(`Storage object not found: "${key}"`);
        }
        return Buffer.from(row.blob_data);
    }
    async delete(key) {
        await getDB().deleteStorageObject(key);
    }
    async exists(key) {
        return getDB().existsStorageObject(key);
    }
    async stat(key) {
        const row = await getDB().getStorageObject(key);
        if (!row)
            return null;
        return {
            size: row.blob_size,
            lastModified: new Date(row.created_at),
        };
    }
    async *list(prefix) {
        const keys = await getDB().listStorageObjects(prefix);
        for (const key of keys) {
            yield key;
        }
    }
    async close() {
        // DB connection lifecycle is managed by the DB adapter, not here
    }
}
export default DbBlobProvider;
//# sourceMappingURL=DbBlobProvider.js.map