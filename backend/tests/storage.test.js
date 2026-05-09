/**
 * storage.test.js – unit tests for every storage provider.
 *
 * Shared test suite: runProviderTestSuite(makeProvider)
 * Tests: put+get round-trip, exists, delete, stat, concurrent puts, large file, list.
 *
 * Provider-specific tests follow the shared suite.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Shared test suite ─────────────────────────────────────────────────────────

/**
 * Runs a standard battery of tests against any BaseStorageProvider implementation.
 * @param {string} suiteName   - display name for the describe block
 * @param {() => Promise<BaseStorageProvider>} makeProvider - factory returning an initialized provider
 */
function runProviderTestSuite(suiteName, makeProvider) {
  describe(suiteName, async () => {
    let provider;
    const PREFIX = `test-${Date.now()}-`;

    before(async () => {
      provider = await makeProvider();
    });

    after(async () => {
      // Cleanup: remove any test objects left behind
      try {
        for await (const key of provider.list(PREFIX)) {
          await provider.delete(key).catch(() => {});
        }
      } catch { /* provider may not support listing */ }
      await provider.close();
    });

    it('put + get round-trip – bytes match exactly', async () => {
      const key = `${PREFIX}roundtrip.bin`;
      const data = Buffer.from('Hello, ImgHoster! 🖼️', 'utf8');
      await provider.put(key, data, 'application/octet-stream');
      const retrieved = await provider.get(key);
      assert.deepStrictEqual(retrieved, data);
      await provider.delete(key);
    });

    it('exists – returns false before put', async () => {
      const key = `${PREFIX}not-yet-created.bin`;
      const found = await provider.exists(key);
      assert.strictEqual(found, false);
    });

    it('exists – returns true after put', async () => {
      const key = `${PREFIX}exists-test.bin`;
      await provider.put(key, Buffer.from('exist'), 'application/octet-stream');
      const found = await provider.exists(key);
      assert.strictEqual(found, true);
      await provider.delete(key);
    });

    it('delete – exists returns false after delete', async () => {
      const key = `${PREFIX}to-delete.bin`;
      await provider.put(key, Buffer.from('bye'), 'application/octet-stream');
      await provider.delete(key);
      const found = await provider.exists(key);
      assert.strictEqual(found, false);
    });

    it('delete – does not throw for non-existent key', async () => {
      await assert.doesNotReject(() => provider.delete(`${PREFIX}never-existed-12345.bin`));
    });

    it('get – throws for non-existent key', async () => {
      await assert.rejects(
        () => provider.get(`${PREFIX}definitely-missing-${Date.now()}.bin`),
        /not found/i
      );
    });

    it('stat – returns null for non-existent key', async () => {
      const result = await provider.stat(`${PREFIX}stat-missing.bin`);
      assert.strictEqual(result, null);
    });

    it('stat – returns correct size and lastModified after put', async () => {
      const key = `${PREFIX}stat-test.bin`;
      const data = Buffer.alloc(512, 0xAB);
      await provider.put(key, data, 'application/octet-stream');
      const s = await provider.stat(key);
      assert.ok(s, 'stat should return an object');
      assert.strictEqual(s.size, 512);
      assert.ok(s.lastModified instanceof Date, 'lastModified should be a Date');
      await provider.delete(key);
    });

    it('put is idempotent – second put overwrites first', async () => {
      const key = `${PREFIX}overwrite.bin`;
      await provider.put(key, Buffer.from('first'), 'application/octet-stream');
      await provider.put(key, Buffer.from('second'), 'application/octet-stream');
      const data = await provider.get(key);
      assert.strictEqual(data.toString(), 'second');
      await provider.delete(key);
    });

    it('concurrent puts – 10 simultaneous uploads, all retrievable', async () => {
      const keys = Array.from({ length: 10 }, (_, i) => `${PREFIX}concurrent-${i}.bin`);
      const payloads = keys.map((_, i) => Buffer.from(`data-${i}`));
      await Promise.all(keys.map((key, i) => provider.put(key, payloads[i], 'application/octet-stream')));
      const results = await Promise.all(keys.map(key => provider.get(key)));
      for (let i = 0; i < 10; i++) {
        assert.deepStrictEqual(results[i], payloads[i], `Concurrent upload ${i} mismatch`);
      }
      await Promise.all(keys.map(key => provider.delete(key)));
    });

    it('large file – 10 MB buffer round-trip', async () => {
      const key = `${PREFIX}large.bin`;
      const big = Buffer.alloc(10 * 1024 * 1024, 0xCC);
      await provider.put(key, big, 'application/octet-stream');
      const got = await provider.get(key);
      assert.strictEqual(got.length, big.length);
      assert.deepStrictEqual(got.subarray(0, 64), big.subarray(0, 64));
      await provider.delete(key);
    });

    it('list – returns keys with matching prefix', async () => {
      const listPrefix = `${PREFIX}list-`;
      const keys = ['a', 'b', 'c'].map(n => `${listPrefix}${n}.bin`);
      await Promise.all(keys.map(k => provider.put(k, Buffer.from(k), 'application/octet-stream')));
      const listed = [];
      for await (const k of provider.list(listPrefix)) {
        listed.push(k);
      }
      for (const k of keys) {
        assert.ok(listed.includes(k), `Expected "${k}" in list results`);
      }
      await Promise.all(keys.map(k => provider.delete(k)));
    });
  });
}

// ── LocalFileProvider tests ───────────────────────────────────────────────────

describe('LocalFileProvider', async () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imghoster-local-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  runProviderTestSuite('LocalFileProvider – shared contract', async () => {
    const { default: LocalFileProvider } = await import('../storage/providers/LocalFileProvider.js');
    const subDir = path.join(tmpDir, 'objects');
    return new LocalFileProvider().init({ dir: subDir });
  });

  describe('LocalFileProvider – specific', () => {
    it('creates directory on init if it does not exist', async () => {
      const { default: LocalFileProvider } = await import('../storage/providers/LocalFileProvider.js');
      const newDir = path.join(tmpDir, 'auto-created');
      assert.ok(!fs.existsSync(newDir), 'directory should not exist before init');
      const p = await new LocalFileProvider().init({ dir: newDir });
      assert.ok(fs.existsSync(newDir), 'directory should exist after init');
      await p.close();
    });

    it('rejects path traversal attempts', async () => {
      const { default: LocalFileProvider } = await import('../storage/providers/LocalFileProvider.js');
      const p = await new LocalFileProvider().init({ dir: path.join(tmpDir, 'safe') });
      await assert.rejects(
        () => p.put('../../../etc/passwd', Buffer.from('pwned'), 'text/plain'),
        /invalid storage key/i
      );
      await p.close();
    });
  });
});

// ── DbBlobProvider tests ──────────────────────────────────────────────────────

describe('DbBlobProvider', async () => {
  let dbPath;
  let db;

  before(async () => {
    dbPath = path.join(os.tmpdir(), `imghoster-dbblob-test-${Date.now()}.db`);
    const { initDB } = await import('../db/index.js');
    await initDB(dbPath);
  });

  after(async () => {
    const { getDB } = await import('../db/index.js');
    await getDB().close();
    fs.unlinkSync(dbPath);
  });

  runProviderTestSuite('DbBlobProvider – shared contract', async () => {
    const { default: DbBlobProvider } = await import('../storage/providers/DbBlobProvider.js');
    return new DbBlobProvider().init({});
  });
});

// ── StorageProviderFactory tests ──────────────────────────────────────────────

describe('StorageProviderFactory', async () => {
  let tmpDir;
  let dbPath;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imghoster-factory-test-'));
    dbPath = path.join(os.tmpdir(), `imghoster-factory-db-${Date.now()}.db`);
    const { initDB } = await import('../db/index.js');
    await initDB(dbPath);
  });

  after(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const { getDB } = await import('../db/index.js');
    await getDB().close().catch(() => {});
    fs.unlinkSync(dbPath);
  });

  it('creates LocalFileProvider when provider=local', async () => {
    const { createStorageProvider } = await import('../storage/StorageProviderFactory.js');
    const p = await createStorageProvider({ provider: 'local', dir: path.join(tmpDir, 'factory-local') });
    assert.strictEqual(p.name, 'local');
    await p.close();
  });

  it('creates DbBlobProvider when provider=dbblob', async () => {
    const { createStorageProvider } = await import('../storage/StorageProviderFactory.js');
    const p = await createStorageProvider({ provider: 'dbblob' });
    assert.strictEqual(p.name, 'dbblob');
    await p.close();
  });

  it('throws for unknown provider', async () => {
    const { createStorageProvider } = await import('../storage/StorageProviderFactory.js');
    await assert.rejects(
      () => createStorageProvider({ provider: 'unknownXYZ' }),
      /unknown provider/i
    );
  });

  it('falls back to dbblob when IMAGE_STORAGE_MODE=blob', async () => {
    const original = process.env.IMAGE_STORAGE_MODE;
    process.env.IMAGE_STORAGE_MODE = 'blob';
    delete process.env.STORAGE_PROVIDER;
    try {
      const { createStorageProvider } = await import('../storage/StorageProviderFactory.js');
      const p = await createStorageProvider();
      assert.strictEqual(p.name, 'dbblob');
      await p.close();
    } finally {
      if (original === undefined) delete process.env.IMAGE_STORAGE_MODE;
      else process.env.IMAGE_STORAGE_MODE = original;
    }
  });
});

// ── ReplicatedProvider tests ──────────────────────────────────────────────────

describe('ReplicatedProvider', async () => {
  let tmpDir;
  let dbPath;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imghoster-replicated-test-'));
    dbPath = path.join(os.tmpdir(), `imghoster-replicated-db-${Date.now()}.db`);
    const { initDB } = await import('../db/index.js');
    await initDB(dbPath);
  });

  after(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const { getDB } = await import('../db/index.js');
    await getDB().close().catch(() => {});
    fs.unlinkSync(dbPath);
  });

  async function makeLocal(subDir) {
    const { default: LocalFileProvider } = await import('../storage/providers/LocalFileProvider.js');
    return new LocalFileProvider().init({ dir: path.join(tmpDir, subDir) });
  }

  it('write fan-out – both providers receive the data', async () => {
    const { default: ReplicatedProvider } = await import('../storage/providers/ReplicatedProvider.js');
    const p1 = await makeLocal('rep-p1');
    const p2 = await makeLocal('rep-p2');
    const rep = await new ReplicatedProvider().init({
      providers: [p1, p2],
      writeQuorum: 2,
      healthCheckIntervalMs: 0,
    });

    const key = 'fan-out-test.bin';
    const data = Buffer.from('replicated data');
    await rep.put(key, data, 'application/octet-stream');

    assert.deepStrictEqual(await p1.get(key), data, 'Provider 1 should have the data');
    assert.deepStrictEqual(await p2.get(key), data, 'Provider 2 should have the data');
    await rep.close();
  });

  it('read fallback – uses secondary when primary fails', async () => {
    const { default: ReplicatedProvider } = await import('../storage/providers/ReplicatedProvider.js');
    const p1 = await makeLocal('rep-fallback-p1');
    const p2 = await makeLocal('rep-fallback-p2');
    const rep = await new ReplicatedProvider().init({
      providers: [p1, p2],
      writeQuorum: 1,
      healthCheckIntervalMs: 0,
    });

    const key = 'fallback-test.bin';
    const data = Buffer.from('only in secondary');

    // Write only to p2 directly
    await p2.put(key, data, 'application/octet-stream');

    // Read via replicated provider should fall back to p2
    const result = await rep.get(key);
    assert.deepStrictEqual(result, data);
    await rep.close();
  });

  it('quorum enforcement – throws when fewer than quorum providers succeed', async () => {
    const { default: ReplicatedProvider } = await import('../storage/providers/ReplicatedProvider.js');
    const p1 = await makeLocal('rep-quorum-p1');

    // Create a failing provider stub
    const failProvider = {
      name: 'fail',
      async put() { throw new Error('intentional failure'); },
      async get() { throw new Error('intentional failure'); },
      async delete() {},
      async exists() { return false; },
      async stat() { return null; },
      async *list() {},
      async close() {},
    };

    const rep = await new ReplicatedProvider().init({
      providers: [failProvider, p1],
      writeQuorum: 2,  // require both to succeed
      healthCheckIntervalMs: 0,
    });

    await assert.rejects(
      () => rep.put('quorum-test.bin', Buffer.from('data'), 'application/octet-stream'),
      /quorum not met/i
    );
    await rep.close();
  });

  it('getHealthStatus – returns health for each provider', async () => {
    const { default: ReplicatedProvider } = await import('../storage/providers/ReplicatedProvider.js');
    const p1 = await makeLocal('rep-health-p1');
    const p2 = await makeLocal('rep-health-p2');
    const rep = await new ReplicatedProvider().init({
      providers: [p1, p2],
      writeQuorum: 1,
      healthCheckIntervalMs: 0,
    });

    const status = rep.getHealthStatus();
    assert.strictEqual(status.length, 2);
    assert.ok(status.every(s => s.health === 'healthy'));
    await rep.close();
  });
});
