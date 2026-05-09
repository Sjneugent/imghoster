import BaseStorageProvider from './BaseStorageProvider.js';
import { createStorageProvider } from './StorageProviderFactory.js';

let storageProvider: BaseStorageProvider | null = null;

/**
 * Initialise the storage provider singleton.
 * Must be called after the DB has been initialised (so DbBlobProvider can call getDB()).
 */
async function initStorage(overrides: Record<string, unknown> = {}): Promise<BaseStorageProvider> {
  storageProvider = await createStorageProvider(overrides);
  return storageProvider;
}

/**
 * Return the active storage provider.
 * Throws if `initStorage()` has not been called yet.
 */
function getStorageProvider(): BaseStorageProvider {
  if (!storageProvider) throw new Error('Storage not initialized. Call initStorage() first.');
  return storageProvider;
}

export { initStorage, getStorageProvider };
export type { BaseStorageProvider };
export default BaseStorageProvider;
