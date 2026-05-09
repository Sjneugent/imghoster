import path from 'node:path';
import fs from 'node:fs';
import BaseStorageProvider from '../BaseStorageProvider.js';
/**
 * LocalFileProvider – stores images on the local filesystem (or any POSIX-mounted
 * network share such as NFS/CIFS/SMB).
 *
 * Config env vars:
 *   STORAGE_LOCAL_DIR   – directory to store objects in (default: UPLOADS_DIR or ../uploads)
 */
class LocalFileProvider extends BaseStorageProvider {
    name = 'local';
    dir = '';
    async init(config) {
        this.dir = String(config.dir
            || process.env.STORAGE_LOCAL_DIR
            || process.env.UPLOADS_DIR
            || path.join(process.cwd(), '..', 'uploads'));
        if (!fs.existsSync(this.dir)) {
            fs.mkdirSync(this.dir, { recursive: true });
        }
        return this;
    }
    safePath(key) {
        // Reject any key containing path separators or directory-traversal sequences
        if (!key || key.includes('/') || key.includes('\\') || key.includes('..') || key === '.') {
            throw new Error(`Invalid storage key: "${key}"`);
        }
        return path.join(this.dir, key);
    }
    async put(key, data, _contentType) {
        const filePath = this.safePath(key);
        await fs.promises.writeFile(filePath, data);
    }
    async get(key) {
        const filePath = this.safePath(key);
        try {
            return await fs.promises.readFile(filePath);
        }
        catch (err) {
            const code = err.code;
            if (code === 'ENOENT')
                throw new Error(`Storage object not found: "${key}"`);
            throw err;
        }
    }
    async delete(key) {
        const filePath = this.safePath(key);
        try {
            await fs.promises.unlink(filePath);
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
    }
    async exists(key) {
        try {
            const filePath = this.safePath(key);
            await fs.promises.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    async stat(key) {
        try {
            const filePath = this.safePath(key);
            const s = await fs.promises.stat(filePath);
            return { size: s.size, lastModified: s.mtime };
        }
        catch {
            return null;
        }
    }
    async *list(prefix) {
        const entries = await fs.promises.readdir(this.dir);
        for (const entry of entries) {
            if (!prefix || entry.startsWith(prefix)) {
                yield entry;
            }
        }
    }
    async close() {
        // Nothing to release for file-based storage
    }
}
export default LocalFileProvider;
//# sourceMappingURL=LocalFileProvider.js.map