import BaseStorageProvider from './BaseStorageProvider.js';

/**
 * StorageProviderFactory – resolves environment variables to a concrete provider.
 *
 * Provider selection:
 *   STORAGE_PROVIDER  – primary selector: local | s3 | azure | gcs | dbblob | replicated
 *
 * Backward-compat alias:
 *   IMAGE_STORAGE_MODE=blob  or  IMAGE_STORAGE_MODE=dbblob → dbblob provider
 *   IMAGE_STORAGE_MODE=file  (or unset)                    → local provider
 *
 * When STORAGE_PROVIDER=replicated:
 *   STORAGE_PROVIDERS – comma-separated list of providers, e.g. "s3,local"
 *   Each provider is configured from its own env vars (see individual provider docs).
 */

async function createNamedProvider(name: string, overrides: Record<string, unknown> = {}): Promise<BaseStorageProvider> {
  const n = name.trim().toLowerCase();

  switch (n) {
    case 'local':
    case 'file': {
      const { default: LocalFileProvider } = await import('./providers/LocalFileProvider.js');
      return new LocalFileProvider().init(overrides);
    }

    case 'dbblob':
    case 'db_blob':
    case 'blob': {
      const { default: DbBlobProvider } = await import('./providers/DbBlobProvider.js');
      return new DbBlobProvider().init(overrides);
    }

    case 's3': {
      const { default: S3Provider } = await import('./providers/S3Provider.js');
      return new S3Provider().init(overrides);
    }

    case 'azure': {
      const { default: AzureBlobProvider } = await import('./providers/AzureBlobProvider.js');
      return new AzureBlobProvider().init(overrides);
    }

    case 'gcs': {
      const { default: GcsProvider } = await import('./providers/GcsProvider.js');
      return new GcsProvider().init(overrides);
    }

    default:
      throw new Error(
        `StorageProviderFactory: unknown provider "${name}". ` +
        'Valid values: local, s3, azure, gcs, dbblob, replicated.'
      );
  }
}

async function createStorageProvider(overrides: Record<string, unknown> = {}): Promise<BaseStorageProvider> {
  // Determine the top-level provider name
  const rawProvider = String(
    overrides.provider
    || process.env.STORAGE_PROVIDER
    || ''
  ).toLowerCase();

  // Backward-compat: honour IMAGE_STORAGE_MODE if STORAGE_PROVIDER is unset
  const legacyMode = (process.env.IMAGE_STORAGE_MODE || 'file').toLowerCase();
  const providerName = rawProvider
    || (legacyMode === 'blob' || legacyMode === 'dbblob' ? 'dbblob' : 'local');

  if (providerName === 'replicated') {
    const rawList = String(
      overrides.providers
      || process.env.STORAGE_PROVIDERS
      || 'local'
    );
    const providerNames = rawList.split(',').map(s => s.trim()).filter(Boolean);
    if (providerNames.length === 0) {
      throw new Error('ReplicatedProvider requires STORAGE_PROVIDERS to be set (comma-separated list).');
    }
    const providers = await Promise.all(providerNames.map(n => createNamedProvider(n)));

    const { default: ReplicatedProvider } = await import('./providers/ReplicatedProvider.js');
    return new ReplicatedProvider().init({
      providers,
      writeQuorum: overrides.writeQuorum,
      healthCheckIntervalMs: overrides.healthCheckIntervalMs,
    });
  }

  return createNamedProvider(providerName, overrides);
}

export { createStorageProvider, createNamedProvider };
