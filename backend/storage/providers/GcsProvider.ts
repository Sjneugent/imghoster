import BaseStorageProvider from '../BaseStorageProvider.js';

// Use variable so TypeScript does not resolve optional peer deps at compile time
const GCS_PKG = '@google-cloud/storage';

/**
 * GcsProvider – stores images in Google Cloud Storage.
 *
 * Requires the optional `@google-cloud/storage` package.
 *
 * Config env vars:
 *   STORAGE_GCS_BUCKET              – required: bucket name
 *   GOOGLE_APPLICATION_CREDENTIALS  – path to service account JSON (optional for
 *                                     environments with Workload Identity / ADC)
 *   STORAGE_GCS_PROJECT             – GCP project ID (optional; inferred from credentials)
 */
class GcsProvider extends BaseStorageProvider {
  readonly name = 'gcs';

  private bucket: string = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bucketClient: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadPkg(): Promise<any> {
    try {
      return await import(GCS_PKG);
    } catch {
      throw new Error(
        'GcsProvider requires the "@google-cloud/storage" package. ' +
        'Install it with: cd backend && npm install @google-cloud/storage'
      );
    }
  }

  async init(config: Record<string, unknown>): Promise<this> {
    this.bucket = String(config.bucket || process.env.STORAGE_GCS_BUCKET || '');
    if (!this.bucket) throw new Error('GcsProvider: STORAGE_GCS_BUCKET is required.');

    const projectId = String(config.projectId || process.env.STORAGE_GCS_PROJECT || '') || undefined;
    const keyFilename = String(config.keyFilename || process.env.GOOGLE_APPLICATION_CREDENTIALS || '') || undefined;

    const { Storage } = await this.loadPkg();

    const storageOpts: Record<string, unknown> = {};
    if (projectId) storageOpts.projectId = projectId;
    if (keyFilename) storageOpts.keyFilename = keyFilename;

    const storage = new Storage(storageOpts);
    this.bucketClient = storage.bucket(this.bucket);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private file(key: string): any {
    return this.bucketClient.file(key);
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.file(key).save(data, { metadata: { contentType } });
  }

  async get(key: string): Promise<Buffer> {
    const fileClient = this.file(key);
    const [found] = await fileClient.exists();
    if (!found) throw new Error(`Storage object not found: "${key}"`);
    const [data] = await fileClient.download();
    return data;
  }

  async delete(key: string): Promise<void> {
    try {
      await this.file(key).delete({ ignoreNotFound: true });
    } catch {
      // ignore
    }
  }

  async exists(key: string): Promise<boolean> {
    const [found] = await this.file(key).exists();
    return found;
  }

  async stat(key: string): Promise<{ size: number; lastModified: Date } | null> {
    try {
      const [metadata] = await this.file(key).getMetadata();
      return {
        size: Number(metadata.size ?? 0),
        lastModified: metadata.updated ? new Date(metadata.updated) : new Date(),
      };
    } catch {
      return null;
    }
  }

  async *list(prefix?: string): AsyncIterable<string> {
    const queryOpts: Record<string, unknown> = {};
    if (prefix) queryOpts.prefix = prefix;
    const [files] = await this.bucketClient.getFiles(queryOpts);
    for (const f of files) {
      yield f.name;
    }
  }

  async close(): Promise<void> {
    // GCS SDK manages its own connection pool
  }
}

export default GcsProvider;
