import BaseStorageProvider from '../BaseStorageProvider.js';
// Use variable so TypeScript does not resolve optional peer deps at compile time
const AZURE_BLOB_PKG = '@azure/storage-blob';
/**
 * AzureBlobProvider – stores images in Azure Blob Storage.
 *
 * Requires the optional `@azure/storage-blob` package.
 *
 * Config env vars:
 *   STORAGE_AZURE_ACCOUNT    – storage account name
 *   STORAGE_AZURE_KEY        – storage account key
 *   STORAGE_AZURE_CONTAINER  – container name (default: "images")
 *   STORAGE_AZURE_URL        – optional full account URL override
 */
class AzureBlobProvider extends BaseStorageProvider {
    name = 'azure';
    container = 'images';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    containerClient = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async loadPkg() {
        try {
            return await import(AZURE_BLOB_PKG);
        }
        catch {
            throw new Error('AzureBlobProvider requires the "@azure/storage-blob" package. ' +
                'Install it with: cd backend && npm install @azure/storage-blob');
        }
    }
    async init(config) {
        const account = String(config.account || process.env.STORAGE_AZURE_ACCOUNT || '');
        const key = String(config.key || process.env.STORAGE_AZURE_KEY || '');
        this.container = String(config.container || process.env.STORAGE_AZURE_CONTAINER || 'images');
        const accountUrl = String(config.url || process.env.STORAGE_AZURE_URL || '') || `https://${account}.blob.core.windows.net`;
        const { BlobServiceClient, StorageSharedKeyCredential } = await this.loadPkg();
        if (!account || !key)
            throw new Error('AzureBlobProvider: STORAGE_AZURE_ACCOUNT and STORAGE_AZURE_KEY are required.');
        const credential = new StorageSharedKeyCredential(account, key);
        const serviceClient = new BlobServiceClient(accountUrl, credential);
        this.containerClient = serviceClient.getContainerClient(this.container);
        // Ensure the container exists
        await this.containerClient.createIfNotExists();
        return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blobClient(key) {
        return this.containerClient.getBlockBlobClient(key);
    }
    async put(key, data, contentType) {
        await this.blobClient(key).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
    }
    async get(key) {
        const client = this.blobClient(key);
        if (!(await client.exists()))
            throw new Error(`Storage object not found: "${key}"`);
        return client.downloadToBuffer();
    }
    async delete(key) {
        await this.blobClient(key).deleteIfExists();
    }
    async exists(key) {
        return this.blobClient(key).exists();
    }
    async stat(key) {
        try {
            const props = await this.blobClient(key).getProperties();
            return {
                size: Number(props.contentLength ?? 0),
                lastModified: props.lastModified ?? new Date(),
            };
        }
        catch {
            return null;
        }
    }
    async *list(prefix) {
        for await (const blob of this.containerClient.listBlobsFlat(prefix ? { prefix } : undefined)) {
            yield blob.name;
        }
    }
    async close() {
        // Azure SDK manages its own connection pool
    }
}
export default AzureBlobProvider;
//# sourceMappingURL=AzureBlobProvider.js.map