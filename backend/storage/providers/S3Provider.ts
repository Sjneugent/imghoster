import BaseStorageProvider from '../BaseStorageProvider.js';

// Use variable so TypeScript does not resolve optional peer deps at compile time
const AWS_SDK_S3 = '@aws-sdk/client-s3';
const AWS_SDK_PRESIGNER = '@aws-sdk/s3-request-presigner';

/**
 * S3Provider – stores images in any S3-compatible object store.
 *
 * Works with AWS S3, MinIO, Backblaze B2, Wasabi, Cloudflare R2, and Ceph.
 * Requires the optional `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
 * packages (install them when you use this provider).
 *
 * Config env vars:
 *   STORAGE_S3_BUCKET            – required: bucket name
 *   STORAGE_S3_REGION            – AWS region (default: us-east-1)
 *   STORAGE_S3_ENDPOINT          – custom endpoint URL (leave blank for AWS)
 *   STORAGE_S3_FORCE_PATH_STYLE  – set "true" for MinIO / path-style URLs
 *   AWS_ACCESS_KEY_ID            – credentials (or use instance profile)
 *   AWS_SECRET_ACCESS_KEY
 *   STORAGE_CDN_BASE_URL         – if set, getSignedUrl() returns a CDN redirect URL
 *   STORAGE_CDN_TTL_SECONDS      – presigned URL TTL in seconds (default: 86400)
 */
class S3Provider extends BaseStorageProvider {
  readonly name = 's3';

  private bucket: string = '';
  private region: string = 'us-east-1';
  private endpoint: string | undefined;
  private forcePathStyle: boolean = false;
  private cdnBaseUrl: string | undefined;
  private cdnTtl: number = 86400;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadS3(): Promise<any> {
    try {
      return await import(AWS_SDK_S3);
    } catch {
      throw new Error(
        'S3Provider requires the "@aws-sdk/client-s3" package. ' +
        'Install it with: cd backend && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'
      );
    }
  }

  async init(config: Record<string, unknown>): Promise<this> {
    this.bucket = String(config.bucket || process.env.STORAGE_S3_BUCKET || '');
    this.region = String(config.region || process.env.STORAGE_S3_REGION || 'us-east-1');
    this.endpoint = String(config.endpoint || process.env.STORAGE_S3_ENDPOINT || '') || undefined;
    this.forcePathStyle =
      String(config.forcePathStyle || process.env.STORAGE_S3_FORCE_PATH_STYLE || 'false').toLowerCase() === 'true';
    this.cdnBaseUrl = String(config.cdnBaseUrl || process.env.STORAGE_CDN_BASE_URL || '') || undefined;
    this.cdnTtl = Number(config.cdnTtl || process.env.STORAGE_CDN_TTL_SECONDS || 86400);

    if (!this.bucket) throw new Error('S3Provider: STORAGE_S3_BUCKET is required.');

    const { S3Client } = await this.loadS3();

    const clientConfig: Record<string, unknown> = { region: this.region };
    if (this.endpoint) clientConfig.endpoint = this.endpoint;
    if (this.forcePathStyle) clientConfig.forcePathStyle = true;

    const accessKeyId = String(config.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '');
    const secretAccessKey = String(config.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '');
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }

    this.client = new S3Client(clientConfig);
    return this;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await this.loadS3();
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
      ContentLength: data.length,
    }));
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await this.loadS3();
    let response: { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        throw new Error(`Storage object not found: "${key}"`);
      }
      throw err;
    }
    if (!response.Body || typeof response.Body.transformToByteArray !== 'function') {
      throw new Error(`S3Provider: unexpected response body for key "${key}"`);
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await this.loadS3();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await this.loadS3();
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string): Promise<{ size: number; lastModified: Date } | null> {
    const { HeadObjectCommand } = await this.loadS3();
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: Number(response.ContentLength ?? 0),
        lastModified: response.LastModified ?? new Date(),
      };
    } catch {
      return null;
    }
  }

  async *list(prefix?: string): AsyncIterable<string> {
    const { ListObjectsV2Command } = await this.loadS3();
    let continuationToken: string | undefined;
    do {
      const params: Record<string, unknown> = { Bucket: this.bucket, MaxKeys: 1000 };
      if (prefix) params.Prefix = prefix;
      if (continuationToken) params.ContinuationToken = continuationToken;

      const response = await this.client.send(new ListObjectsV2Command(params));
      for (const obj of (response.Contents ?? [])) {
        if (obj.Key) yield obj.Key;
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  /**
   * Generate a presigned URL for direct client access (CDN delivery mode).
   * If `STORAGE_CDN_BASE_URL` is set, returns a CDN URL instead.
   */
  async getSignedUrl(key: string): Promise<string> {
    if (this.cdnBaseUrl) {
      return `${this.cdnBaseUrl.replace(/\/$/, '')}/${key}`;
    }
    const { getSignedUrl } = await import(AWS_SDK_PRESIGNER);
    const { GetObjectCommand } = await this.loadS3();
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.cdnTtl }
    );
  }

  async close(): Promise<void> {
    // The AWS SDK client manages its own connection pool
  }
}

export default S3Provider;
