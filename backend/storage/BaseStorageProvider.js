/**
 * BaseStorageProvider – abstract interface for pluggable image/object storage backends.
 *
 * Each provider (local disk, S3, Azure Blob, GCS, DbBlob, Replicated) extends this
 * class and implements every method.  The `key` is always the image `filename` field
 * stored in the DB (e.g. "abc123.jpg"), keeping the meaning consistent across backends.
 */
class BaseStorageProvider {
}
export default BaseStorageProvider;
//# sourceMappingURL=BaseStorageProvider.js.map