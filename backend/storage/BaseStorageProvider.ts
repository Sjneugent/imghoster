/**
 * BaseStorageProvider – abstract interface for pluggable image/object storage backends.
 *
 * Each provider (local disk, S3, Azure Blob, GCS, DbBlob, Replicated) extends this
 * class and implements every method.  The `key` is always the image `filename` field
 * stored in the DB (e.g. "abc123.jpg"), keeping the meaning consistent across backends.
 */
abstract class BaseStorageProvider {
  /** Unique identifier used to tag image rows (e.g. "local", "s3", "dbblob"). */
  abstract readonly name: string;

  /** Initialise the provider.  Called once at server startup. */
  abstract init(config: Record<string, unknown>): Promise<this>;

  /** Store an object.  Overwrites any existing object with the same key. */
  abstract put(key: string, data: Buffer, contentType: string): Promise<void>;

  /** Retrieve an object.  Throws if the object does not exist. */
  abstract get(key: string): Promise<Buffer>;

  /** Delete an object.  Should not throw if the object is already absent. */
  abstract delete(key: string): Promise<void>;

  /** Return `true` if the object exists, `false` otherwise. */
  abstract exists(key: string): Promise<boolean>;

  /**
   * Return basic object metadata, or `null` if the object does not exist.
   * `lastModified` may be set to `new Date()` by providers that don't track it.
   */
  abstract stat(key: string): Promise<{ size: number; lastModified: Date } | null>;

  /**
   * Async-iterate over keys.  An optional `prefix` filters keys to those that
   * start with the given string.  Used by migration tooling.
   */
  abstract list(prefix?: string): AsyncIterable<string>;

  /** Release any held resources (connections, timers, etc.). */
  abstract close(): Promise<void>;
}

export default BaseStorageProvider;
