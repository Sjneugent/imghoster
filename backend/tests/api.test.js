/**
 * Backend unit & integration tests using Node.js built-in test runner.
 * Run:  cd backend && node --test tests/
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';

// ── Test DB setup ─────────────────────────────────────────────────────────────
const TEST_DB = '/tmp/imghoster_test.db';
const TEST_UPLOADS = '/tmp/imghoster_test_uploads';

function clearDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return;
  }

  for (const entry of fs.readdirSync(dirPath)) {
    fs.rmSync(`${dirPath}/${entry}`, { recursive: true, force: true });
  }
}

// Clean up before run
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
clearDirectory(TEST_UPLOADS);

process.env.DB_PATH = TEST_DB;
process.env.SESSION_SECRET = 'test-session-secret-123';
process.env.UPLOADS_DIR = TEST_UPLOADS;
process.env.PORT = '0'; // random port
process.env.NODE_ENV = 'test';

let db;

// ── DB unit tests ─────────────────────────────────────────────────────────────
describe('Database helpers', () => {
  before(async () => {
    db = await import('../db/index.js');
    await db.initDB(TEST_DB);
  });

  test('createUser / getUserByUsername', async () => {
    const id = await db.createUser('testuser', 'Password1!', false);
    assert.ok(id > 0, 'should return an auto-increment id');

    const user = await db.getUserByUsername('testuser');
    assert.equal(user.username, 'testuser');
    assert.equal(user.is_admin, 0);
  });

  test('verifyPassword – correct password', async () => {
    const user = await db.getUserByUsername('testuser');
    assert.ok(await db.verifyPassword('Password1!', user.password_hash));
  });

  test('verifyPassword – wrong password', async () => {
    const user = await db.getUserByUsername('testuser');
    assert.equal(await db.verifyPassword('wrong', user.password_hash), false);
  });

  test('getUserByUsername is case-insensitive', async () => {
    const u = await db.getUserByUsername('TESTUSER');
    assert.ok(u, 'should find user regardless of case');
  });

  test('createUser – duplicate username throws', async () => {
    await assert.rejects(() => db.createUser('testuser', 'AnotherPass1!'), /UNIQUE/);
  });

  test('createImage / getImageBySlug / slugExists', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const imgId = await db.createImage({
      filename: 'abc123.jpg',
      originalName: 'my-photo.jpg',
      slug: 'my-photo',
      mimeType: 'image/jpeg',
      size: 4096,
      userId,
    });
    assert.ok(imgId > 0);
    assert.ok(await db.slugExists('my-photo'));
    assert.equal(await db.slugExists('nonexistent'), false);

    const img = await db.getImageBySlug('my-photo');
    assert.equal(img.slug, 'my-photo');
    assert.equal(img.size, 4096);
  });

  test('listImagesByUser', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const list = await db.listImagesByUser(userId);
    assert.ok(list.length >= 1);
    assert.equal(list[0].user_id, userId);
  });

  test('recordView / getImageStats', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const img = await db.getImageBySlug('my-photo');

    await db.recordView(img.id, '1.2.3.4', 'https://github.com');
    await db.recordView(img.id, '5.6.7.8', null);

    const stats = await db.getImageStats(userId);
    const row = stats.find(s => s.slug === 'my-photo');
    assert.ok(row, 'stats row should exist');
    assert.equal(row.view_count, 2);
  });

  test('deleteImage removes record', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const imgId2 = await db.createImage({
      filename: 'del.jpg',
      originalName: 'del.jpg',
      slug: 'to-delete',
      mimeType: 'image/jpeg',
      size: 100,
      userId,
    });
    await db.deleteImage(imgId2);
    assert.equal(await db.getImageBySlug('to-delete'), undefined);
  });

  test('listUsers / deleteUser', async () => {
    await db.createUser('tempuser', 'TempPass1!', false);
    const beforeCount = (await db.listUsers()).length;
    const temp = await db.getUserByUsername('tempuser');
    await db.deleteUser(temp.id);
    const afterCount = (await db.listUsers()).length;
    assert.equal(afterCount, beforeCount - 1);
  });

  test('updateUserPassword', async () => {
    await db.updateUserPassword((await db.getUserByUsername('testuser')).id, 'NewPass999!');
    const user = await db.getUserByUsername('testuser');
    assert.ok(await db.verifyPassword('NewPass999!', user.password_hash));
    assert.equal(await db.verifyPassword('Password1!', user.password_hash), false);
  });

  test('searchImages – finds by slug', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const results = await db.searchImages('my-photo', userId, false);
    assert.ok(results.length >= 1, 'should find at least one result');
    assert.ok(results.some(r => r.slug === 'my-photo'));
  });

  test('searchImages – admin searches all users', async () => {
    const results = await db.searchImages('my-photo', null, true);
    assert.ok(results.length >= 1, 'admin should find results across all users');
    assert.ok(results[0].username, 'admin search should include username');
  });

  test('searchImages – no results for non-matching query', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const results = await db.searchImages('zzz-nonexistent-zzz', userId, false);
    assert.equal(results.length, 0);
  });

  test('getImagesByIds – returns matching images', async () => {
    const img = await db.getImageBySlug('my-photo');
    const results = await db.getImagesByIds([img.id]);
    assert.equal(results.length, 1);
    assert.equal(results[0].slug, 'my-photo');
  });

  test('getImagesByIds – returns empty for no IDs', async () => {
    const results = await db.getImagesByIds([]);
    assert.equal(results.length, 0);
  });

  test('db blob storage – persists and retrieves bytes by slug/image id', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const blobSlug = 'blob-sample';
    const blobBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);

    const imgId = await db.createImage({
      filename: 'blob-sample.png',
      originalName: 'blob-sample.png',
      slug: blobSlug,
      mimeType: 'image/png',
      size: blobBytes.length,
      storageBackend: 'db_blob',
      userId,
    });

    await db.upsertImageBlob(imgId, blobBytes);

    const bySlug = await db.getImageBySlug(blobSlug);
    assert.equal(bySlug.storage_backend, 'db_blob');

    const blobRow = await db.getImageBlobByImageId(imgId);
    assert.ok(blobRow, 'blob row should exist');
    assert.equal(blobRow.blob_size, blobBytes.length);
    assert.equal(Buffer.compare(blobRow.blob_data, blobBytes), 0);
  });

  test('db blob storage – duplicate hash lookup remains queryable', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const hashValue = 'hash-for-blob-record-001';
    const imgId = await db.createImage({
      filename: 'blob-hash-test.jpg',
      originalName: 'blob-hash-test.jpg',
      slug: 'blob-hash-test',
      mimeType: 'image/jpeg',
      size: 12,
      storageBackend: 'db_blob',
      fileHash: hashValue,
      userId,
    });
    await db.upsertImageBlob(imgId, Buffer.from('hello-blob'));

    const dup = await db.checkDuplicateHash(hashValue);
    assert.ok(dup, 'hash lookup should find the record');
    assert.equal(dup.slug, 'blob-hash-test');
  });

  test('file->blob migration script preserves bytes and updates storage backend', async () => {
    const { migrateFileStorageToBlobs } = await import('../scripts/storage-migrate-to-blobs.js');
    const userId = (await db.getUserByUsername('testuser')).id;
    const checkpointPath = '/tmp/imghoster_blob_checkpoint_case1.json';
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);

    const legacyBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );

    const legacyFilename = 'legacy-migration-check.png';
    const legacySlug = 'legacy-migration-check';
    const legacyPath = `${TEST_UPLOADS}/${legacyFilename}`;
    fs.writeFileSync(legacyPath, legacyBytes);

    const legacyId = await db.createImage({
      filename: legacyFilename,
      originalName: 'legacy-upload.png',
      slug: legacySlug,
      mimeType: 'image/png',
      size: legacyBytes.length,
      storageBackend: 'file',
      userId,
    });

    const summary = await migrateFileStorageToBlobs({
      dbPath: TEST_DB,
      uploadsDir: TEST_UPLOADS,
      checkpointPath,
      resume: false,
      verify: true,
      verifyOnly: false,
      dryRun: false,
      deleteFiles: false,
      closeWhenDone: false,
      log: () => {},
    });

    assert.ok(summary.migrated >= 1, 'at least one file-backed image should migrate');
    assert.ok(summary.verified >= 1, 'at least one migrated image should verify');
    assert.ok(summary.migratedIds.includes(legacyId), 'legacy image should be included in migration ids');

    const migratedRow = await db.getImageBySlug(legacySlug);
    assert.equal(migratedRow.storage_backend, 'db_blob');

    const blobRow = await db.getImageBlobByImageId(legacyId);
    assert.ok(blobRow, 'blob row should exist after migration');
    assert.equal(Buffer.compare(Buffer.from(blobRow.blob_data), legacyBytes), 0);

    // Legacy file remains because deleteFiles=false
    assert.equal(fs.existsSync(legacyPath), true);
  });

  test('file->blob migration verify-only detects parity without rewriting data', async () => {
    const { migrateFileStorageToBlobs } = await import('../scripts/storage-migrate-to-blobs.js');
    const checkpointPath = '/tmp/imghoster_blob_checkpoint_case2.json';
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
    const summary = await migrateFileStorageToBlobs({
      dbPath: TEST_DB,
      uploadsDir: TEST_UPLOADS,
      checkpointPath,
      resume: false,
      verify: true,
      verifyOnly: true,
      dryRun: false,
      deleteFiles: false,
      closeWhenDone: false,
      log: () => {},
    });

    assert.equal(summary.migrated, 0);
    assert.ok(summary.verified >= 1, 'verify-only should still compare file bytes to blob bytes');
    assert.equal(summary.failures, 0);
  });

  test('file->blob migration supports checkpoint resume across runs', async () => {
    const { migrateFileStorageToBlobs } = await import('../scripts/storage-migrate-to-blobs.js');
    const userId = (await db.getUserByUsername('testuser')).id;
    const checkpointPath = '/tmp/imghoster_blob_checkpoint_test.json';
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);

    const bytesA = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const bytesB = Buffer.from([0x05, 0x06, 0x07, 0x08]);
    const fileA = 'resume-a.bin';
    const fileB = 'resume-b.bin';
    fs.writeFileSync(`${TEST_UPLOADS}/${fileA}`, bytesA);
    fs.writeFileSync(`${TEST_UPLOADS}/${fileB}`, bytesB);

    const idA = await db.createImage({
      filename: fileA,
      originalName: fileA,
      slug: 'resume-a',
      mimeType: 'image/png',
      size: bytesA.length,
      storageBackend: 'file',
      userId,
    });
    const idB = await db.createImage({
      filename: fileB,
      originalName: fileB,
      slug: 'resume-b',
      mimeType: 'image/png',
      size: bytesB.length,
      storageBackend: 'file',
      userId,
    });

    const firstRun = await migrateFileStorageToBlobs({
      dbPath: TEST_DB,
      uploadsDir: TEST_UPLOADS,
      checkpointPath,
      verify: true,
      verifyOnly: false,
      dryRun: false,
      deleteFiles: false,
      maxMigrations: 1,
      closeWhenDone: false,
      log: () => {},
    });

    assert.equal(firstRun.migrated, 1, 'first run should process exactly one image');
    assert.equal(fs.existsSync(checkpointPath), true, 'checkpoint file should be created');

    const checkpointAfterFirst = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    assert.ok(checkpointAfterFirst.lastMigratedImageId > 0);

    const secondRun = await migrateFileStorageToBlobs({
      dbPath: TEST_DB,
      uploadsDir: TEST_UPLOADS,
      checkpointPath,
      verify: true,
      verifyOnly: false,
      dryRun: false,
      deleteFiles: false,
      closeWhenDone: false,
      log: () => {},
    });

    assert.ok(secondRun.migrated >= 1, 'second run should continue from checkpoint');

    const rowA = await db.getImageBySlug('resume-a');
    const rowB = await db.getImageBySlug('resume-b');
    assert.equal(rowA.storage_backend, 'db_blob');
    assert.equal(rowB.storage_backend, 'db_blob');

    const blobA = await db.getImageBlobByImageId(idA);
    const blobB = await db.getImageBlobByImageId(idB);
    assert.equal(Buffer.compare(Buffer.from(blobA.blob_data), bytesA), 0);
    assert.equal(Buffer.compare(Buffer.from(blobB.blob_data), bytesB), 0);
  });

  test('exportData / importData round-trip', async () => {
    const exported = await db.exportData();
    assert.ok(exported.users.length >= 1, 'should have at least one user');
    assert.ok(exported.images.length >= 1, 'should have at least one image');
    assert.ok(Array.isArray(exported.image_views), 'should have image_views array');

    // Import into the same DB (verifies the import logic works)
    await db.importData(exported);
    const afterImport = await db.exportData();
    assert.equal(afterImport.users.length, exported.users.length);
    assert.equal(afterImport.images.length, exported.images.length);
  });

  // ── Thumbnail tests ───────────────────────────────────────────────────────
  test('upsertImageThumbnail / getImageThumbnail', async () => {
    const img = await db.getImageBySlug('my-photo');
    const thumbData = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    await db.upsertImageThumbnail(img.id, thumbData, 300, 300);

    const thumb = await db.getImageThumbnail(img.id);
    assert.ok(thumb, 'thumbnail should exist');
    assert.equal(Buffer.compare(Buffer.from(thumb.thumb_data), thumbData), 0);
    assert.equal(thumb.width, 300);
    assert.equal(thumb.height, 300);
  });

  test('getImageThumbnail – returns null for non-existent', async () => {
    const thumb = await db.getImageThumbnail(999999);
    assert.equal(thumb, undefined);
  });

  // ── Album tests ───────────────────────────────────────────────────────────
  test('createAlbum / getAlbumById / listAlbumsByUser', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const albumId = await db.createAlbum({ name: 'Test Album', description: 'A test album', userId });
    assert.ok(albumId > 0);

    const album = await db.getAlbumById(albumId);
    assert.equal(album.name, 'Test Album');
    assert.equal(album.description, 'A test album');
    assert.equal(album.user_id, userId);

    const albums = await db.listAlbumsByUser(userId);
    assert.ok(albums.length >= 1);
    assert.ok(albums.some(a => a.id === albumId));
  });

  test('updateAlbum', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const albums = await db.listAlbumsByUser(userId);
    const album = albums[0];
    await db.updateAlbum(album.id, { name: 'Renamed Album' });
    const updated = await db.getAlbumById(album.id);
    assert.equal(updated.name, 'Renamed Album');
  });

  test('addImagesToAlbum / getAlbumImages / removeImageFromAlbum', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const albums = await db.listAlbumsByUser(userId);
    const albumId = albums[0].id;
    const img = await db.getImageBySlug('my-photo');

    await db.addImagesToAlbum(albumId, [img.id]);
    const images = await db.getAlbumImages(albumId);
    assert.ok(images.length >= 1);
    assert.ok(images.some(i => i.id === img.id));

    await db.removeImageFromAlbum(albumId, img.id);
    const afterRemove = await db.getAlbumImages(albumId);
    assert.ok(!afterRemove.some(i => i.id === img.id));
  });

  test('deleteAlbum', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const albumId = await db.createAlbum({ name: 'To Delete', description: null, userId });
    await db.deleteAlbum(albumId);
    const gone = await db.getAlbumById(albumId);
    assert.equal(gone, undefined);
  });

  // ── Visibility tests ──────────────────────────────────────────────────────
  test('updateImageVisibility', async () => {
    const img = await db.getImageBySlug('my-photo');
    await db.updateImageVisibility(img.id, 'unlisted');
    const updated = await db.getImageBySlug('my-photo');
    assert.equal(updated.visibility, 'unlisted');

    // Reset back to public
    await db.updateImageVisibility(img.id, 'public');
  });

  // ── Expiration tests ──────────────────────────────────────────────────────
  test('updateImageExpiration / getExpiredImages', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;
    const imgId = await db.createImage({
      filename: 'expiring.png',
      originalName: 'expiring.png',
      slug: 'expiring-test',
      mimeType: 'image/png',
      size: 100,
      userId,
    });

    // Set expiration to the past
    const pastDate = new Date(Date.now() - 60000).toISOString();
    await db.updateImageExpiration(imgId, pastDate);

    const expired = await db.getExpiredImages();
    assert.ok(expired.some(i => i.id === imgId), 'expired list should include the image');

    // Clean up
    await db.deleteImage(imgId);
  });

  // ── Storage quota tests ───────────────────────────────────────────────────
  test('setUserStorageQuota / getUserStorageQuota / getUserStorageUsed', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;

    await db.setUserStorageQuota(userId, 1048576); // 1 MB
    const quota = await db.getUserStorageQuota(userId);
    assert.equal(quota, 1048576);

    const used = await db.getUserStorageUsed(userId);
    assert.equal(typeof used, 'number');
    assert.ok(used >= 0);

    // Reset quota to 0 (unlimited)
    await db.setUserStorageQuota(userId, 0);
  });

  // ── TOTP tests ────────────────────────────────────────────────────────────
  test('saveTotpSecret / getTotpSecret / enableTotp / isTotpEnabled / disableTotp', async () => {
    const userId = (await db.getUserByUsername('testuser')).id;

    // Initially not enabled
    assert.equal(await db.isTotpEnabled(userId), false);

    // Save secret
    await db.saveTotpSecret(userId, 'JBSWY3DPEHPK3PXP');
    const secretRow = await db.getTotpSecret(userId);
    assert.equal(secretRow.secret, 'JBSWY3DPEHPK3PXP');

    // Enable TOTP
    await db.enableTotp(userId);
    assert.equal(await db.isTotpEnabled(userId), true);

    // Disable TOTP
    await db.disableTotp(userId);
    assert.equal(await db.isTotpEnabled(userId), false);
  });
});

// ── HTTP integration tests ────────────────────────────────────────────────────
describe('HTTP API', () => {
  let app, server, baseUrl, adminId;
  let createdApiToken = '';
  const originalStorageMode = process.env.IMAGE_STORAGE_MODE;

  before(async () => {
    // Create a second test DB for HTTP tests to avoid cross-contamination
    const HTTP_DB = '/tmp/imghoster_http_test.db';
    if (fs.existsSync(HTTP_DB)) fs.unlinkSync(HTTP_DB);
    clearDirectory(TEST_UPLOADS);
    process.env.DB_PATH = HTTP_DB;
    process.env.IMAGE_STORAGE_MODE = 'blob';

    const dbHttp = await import('../db/index.js');
    await dbHttp.initDB(HTTP_DB);
    adminId = await dbHttp.createUser('admin', 'AdminPass1!', true);
    await dbHttp.createUser('regular', 'RegPass1!', false);

    // server.js now exports a Promise that resolves to the server
    const { default: serverPromise } = await import('../server.js');
    server = await serverPromise;

    // Wait for the server to start listening
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    if (server) server.close();
    if (originalStorageMode === undefined) {
      delete process.env.IMAGE_STORAGE_MODE;
    } else {
      process.env.IMAGE_STORAGE_MODE = originalStorageMode;
    }
  });

  // Helper: perform a request and return { status, body, headers, cookies }
  function request(method, urlPath, { body, headers = {}, cookies = '' } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, baseUrl);
      const opts = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies,
          ...headers,
        },
      };

      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
            cookies: res.headers['set-cookie'] || [],
          });
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  let sessionCookie = '';

  test('GET /api/auth/me – unauthenticated from localhost returns admin', async () => {
    const r = await request('GET', '/api/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.username, 'localhost-admin');
    assert.equal(r.body.isAdmin, true);
  });

  test('POST /api/auth/login – wrong password returns 401', async () => {
    const r = await request('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'wrongpassword' },
    });
    assert.equal(r.status, 401);
    assert.ok(r.body.error);
  });

  test('GET /api/auth/captcha + POST /api/auth/register – creates account', async () => {
    const captchaResp = await request('GET', '/api/auth/captcha');
    assert.equal(captchaResp.status, 200);
    assert.ok(captchaResp.body.svg);

    const captchaCookie = captchaResp.cookies.map(c => c.split(';')[0]).join('; ');
    assert.ok(captchaCookie, 'captcha request should establish a session cookie');

    const chars = [...captchaResp.body.svg.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map(m => m[1]);
    const captchaText = chars.join('');
    assert.equal(captchaText.length, 6, 'captcha should expose exactly 6 characters');

    const registerResp = await request('POST', '/api/auth/register', {
      cookies: captchaCookie,
      body: {
        email: 'newuser@example.com',
        username: 'newuser',
        realName: 'New User',
        password: 'NewUserPass1!',
        captcha: captchaText,
      },
    });

    assert.equal(registerResp.status, 201, `Expected 201 but got ${registerResp.status}: ${JSON.stringify(registerResp.body)}`);
    assert.equal(registerResp.body.username, 'newuser');
    assert.equal(registerResp.body.email, 'newuser@example.com');
  });

  test('POST /api/auth/register – rejects invalid captcha', async () => {
    const captchaResp = await request('GET', '/api/auth/captcha');
    const captchaCookie = captchaResp.cookies.map(c => c.split(';')[0]).join('; ');

    const registerResp = await request('POST', '/api/auth/register', {
      cookies: captchaCookie,
      body: {
        email: 'badcaptcha@example.com',
        username: 'badcaptcha',
        realName: 'Bad Captcha',
        password: 'BadCaptcha1!',
        captcha: 'WRONG1',
      },
    });

    assert.equal(registerResp.status, 400);
    assert.ok(registerResp.body.error);
  });

  test('POST /api/auth/login – correct credentials returns user info', async () => {
    const r = await request('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'AdminPass1!' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.username, 'admin');
    assert.equal(r.body.isAdmin, true);
    // Capture session cookie for subsequent tests
    sessionCookie = r.cookies.map(c => c.split(';')[0]).join('; ');
    assert.ok(sessionCookie, 'should receive a session cookie');
  });

  test('GET /api/auth/me – authenticated returns user', async () => {
    const r = await request('GET', '/api/auth/me', { cookies: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.body.username, 'admin');
  });

  test('POST /api/auth/tokens – creates time-limited API token', async () => {
    const r = await request('POST', '/api/auth/tokens', {
      cookies: sessionCookie,
      body: { label: 'test-token', durationMinutes: 60 },
    });
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.token, 'should return plaintext token once');
    createdApiToken = r.body.token;
  });

  test('GET /api/images – requires token when localhost bypass disabled', async () => {
    const originalBypass = process.env.LOCALHOST_BYPASS;
    process.env.LOCALHOST_BYPASS = 'false';
    try {
      const noToken = await request('GET', '/api/images', { cookies: sessionCookie });
      assert.equal(noToken.status, 401);
      assert.ok(noToken.body.error);

      const withToken = await request('GET', '/api/images', {
        cookies: sessionCookie,
        headers: { Authorization: `Bearer ${createdApiToken}` },
      });
      assert.equal(withToken.status, 200, `Expected 200 but got ${withToken.status}: ${JSON.stringify(withToken.body)}`);
      assert.ok(Array.isArray(withToken.body));
    } finally {
      if (originalBypass === undefined) {
        delete process.env.LOCALHOST_BYPASS;
      } else {
        process.env.LOCALHOST_BYPASS = originalBypass;
      }
    }
  });

  test('GET /api/images – returns empty array for new user', async () => {
    const r = await request('GET', '/api/images', { cookies: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  test('GET /api/admin/users – admin can list users', async () => {
    const r = await request('GET', '/api/admin/users', { cookies: sessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 2);
  });

  test('GET /api/admin/users – non-admin from localhost still gets access', async () => {
    // Login as regular user
    const loginR = await request('POST', '/api/auth/login', {
      body: { username: 'regular', password: 'RegPass1!' },
    });
    const regCookie = loginR.cookies.map(c => c.split(';')[0]).join('; ');

    const r = await request('GET', '/api/admin/users', { cookies: regCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  test('POST /api/auth/logout – clears session', async () => {
    const r = await request('POST', '/api/auth/logout', { cookies: sessionCookie });
    assert.equal(r.status, 200);

    // After logout, /me returns localhost-admin (because tests run on 127.0.0.1)
    const meR = await request('GET', '/api/auth/me', { cookies: sessionCookie });
    assert.equal(meR.status, 200);
    assert.equal(meR.body.username, 'localhost-admin');
  });

  test('GET /api/admin/users – accessible without auth from localhost', async () => {
    const r = await request('GET', '/api/admin/users');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });

  // Helper: perform a multipart upload request
  function uploadRequest(urlPath, filename, fileContent, mimeType, { cookies = '', fields = {} } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, baseUrl);
      const boundary = '----TestBoundary' + Date.now();
      const parts = [];

      for (const [key, value] of Object.entries(fields)) {
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`
        ));
      }

      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
      ));
      parts.push(fileContent);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const opts = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          Cookie: cookies,
        },
      };

      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  function uploadRequestMulti(urlPath, files, { cookies = '', fields = {} } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, baseUrl);
      const boundary = '----TestBoundary' + Date.now();
      const parts = [];

      for (const [key, value] of Object.entries(fields)) {
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`
        ));
      }

      for (const f of files) {
        parts.push(Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="image"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.mimeType}\r\n\r\n`
        ));
        parts.push(f.content);
        parts.push(Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const opts = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          Cookie: cookies,
        },
      };

      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  test('POST /api/images/upload – localhost without auth can upload', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );
    const uploadArtifactsBefore = fs.readdirSync(TEST_UPLOADS).filter((name) => !name.startsWith('.'));

    const r = await uploadRequest('/api/images/upload', 'test.png', tinyPng, 'image/png');
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.id, 'should return image id');
    assert.ok(r.body.slug, 'should return slug');
    assert.ok(r.body.url, 'should return url');

    const uploadArtifactsAfter = fs.readdirSync(TEST_UPLOADS).filter((name) => !name.startsWith('.'));
    assert.equal(uploadArtifactsAfter.length, uploadArtifactsBefore.length, 'blob mode should not leave image files in uploads directory');
  });

  test('POST /api/images/upload – accepts compress flag', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );

    const r = await uploadRequest('/api/images/upload', 'compress-test.png', tinyPng, 'image/png', {
      fields: { compress: 'true' },
    });

    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.compression, 'should include compression metadata');
    assert.equal(r.body.compression.requested, true);
  });

  test('POST /api/images/upload – supports uploading multiple files', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );
    const tinyGif = Buffer.from('R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64');

    const r = await uploadRequestMulti('/api/images/upload', [
      { filename: 'multi-1.png', content: tinyPng, mimeType: 'image/png' },
      { filename: 'multi-2.gif', content: tinyGif, mimeType: 'image/gif' },
    ]);

    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.uploaded), 'should return uploaded array for multi-upload');
    assert.equal(r.body.uploaded.length, 2);
  });

  test('POST /api/images/upload – supports mixed extensions in one batch', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );
    const tinyGif = Buffer.from('R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64');
    const tinySvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

    const r = await uploadRequestMulti('/api/images/upload', [
      { filename: 'mixed-1.gif', content: tinyGif, mimeType: 'image/gif' },
      { filename: 'mixed-2.png', content: tinyPng, mimeType: 'image/png' },
      { filename: 'mixed-3.svg', content: tinySvg, mimeType: 'image/svg+xml' },
    ]);

    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.uploaded), 'should return uploaded array for mixed multi-upload');
    assert.equal(r.body.uploaded.length, 3);
    assert.ok(r.body.uploaded.every(item => typeof item.url === 'string' && item.url.includes('/i/')));
  });

  test('POST /api/images/upload – accepts valid SVG uploads', async () => {
    const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

    const r = await uploadRequest('/api/images/upload', 'valid.svg', svgPayload, 'image/svg+xml');
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.id);
  });

  test('POST /api/images/upload – rejects corrupt JPEG files', async () => {
    const bad = Buffer.from([0xFF, 0xD8, 0x00, 0x00, 0x00, 0x00]);
    const r = await uploadRequest('/api/images/upload', 'bad.jpg', bad, 'image/jpeg');
    assert.equal(r.status, 400, `Expected 400 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), /invalid image file/i);
  });

  test('POST /api/images/upload – rejects corrupt PNG files', async () => {
    const bad = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00, 0x00, 0x00]);
    const r = await uploadRequest('/api/images/upload', 'bad.png', bad, 'image/png');
    assert.equal(r.status, 400, `Expected 400 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), /invalid image file/i);
  });

  test('POST /api/images/upload – rejects corrupt GIF files', async () => {
    const bad = Buffer.from('GIF89aBAD', 'ascii');
    const r = await uploadRequest('/api/images/upload', 'bad.gif', bad, 'image/gif');
    assert.equal(r.status, 400, `Expected 400 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), /invalid image file/i);
  });

  test('POST /api/images/upload – rejects corrupt WebP files', async () => {
    const bad = Buffer.from('RIFF0000WEBPFAIL', 'ascii');
    const r = await uploadRequest('/api/images/upload', 'bad.webp', bad, 'image/webp');
    assert.equal(r.status, 400, `Expected 400 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), /invalid image file/i);
  });

  test('POST /api/images/upload – rejects corrupt SVG files', async () => {
    const bad = Buffer.from('<svg><g></svg', 'utf8');
    const r = await uploadRequest('/api/images/upload', 'bad.svg', bad, 'image/svg+xml');
    assert.equal(r.status, 400, `Expected 400 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), /invalid image file/i);
  });

  test('POST /api/images/upload – rejects files exceeding per-file size limit', async () => {
    const oversized = Buffer.alloc((10 * 1024 * 1024) + 1, 0x00);
    const r = await uploadRequest('/api/images/upload', 'too-large.png', oversized, 'image/png');
    assert.equal(r.status, 400, `Expected 400 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), /10 MB or smaller/i);
  });

  test('POST /api/images/upload – persists optional comment and tags', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );

    const r = await uploadRequest('/api/images/upload', 'meta-test.png', tinyPng, 'image/png', {
      fields: {
        comment: 'Homepage hero screenshot',
        tags: 'design, hero, screenshot',
      },
    });
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);

    const listR = await request('GET', '/api/images');
    assert.equal(listR.status, 200);
    const created = listR.body.find((img) => img.slug === r.body.slug);
    assert.ok(created, 'uploaded image should be returned in list');
    assert.equal(created.comment, 'Homepage hero screenshot');
    assert.equal(created.tags, 'design, hero, screenshot');
  });

  test('GET /api/images – localhost without auth returns images', async () => {
    const r = await request('GET', '/api/images');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 1, 'should contain at least the uploaded image');
  });

  test('GET /api/stats/timeline – denies access to another user image when bypass disabled', async () => {
    const allImages = await request('GET', '/api/images');
    assert.equal(allImages.status, 200);
    assert.ok(Array.isArray(allImages.body));
    assert.ok(allImages.body.length >= 1, 'expected at least one image to exist');
    const targetImageId = allImages.body[0].id;

    const loginRegular = await request('POST', '/api/auth/login', {
      body: { username: 'regular', password: 'RegPass1!' },
    });
    assert.equal(loginRegular.status, 200);
    const regularCookie = loginRegular.cookies.map(c => c.split(';')[0]).join('; ');
    assert.ok(regularCookie, 'regular user should receive session cookie');

    const regularTokenResp = await request('POST', '/api/auth/tokens', {
      cookies: regularCookie,
      body: { label: 'regular-test-token', durationMinutes: 60 },
    });
    assert.equal(regularTokenResp.status, 201, `Expected 201 but got ${regularTokenResp.status}: ${JSON.stringify(regularTokenResp.body)}`);
    assert.ok(regularTokenResp.body.token, 'regular user should get API token');

    const originalBypass = process.env.LOCALHOST_BYPASS;
    process.env.LOCALHOST_BYPASS = 'false';
    try {
      const denied = await request('GET', `/api/stats/timeline?imageId=${targetImageId}&days=30`, {
        cookies: regularCookie,
        headers: { Authorization: `Bearer ${regularTokenResp.body.token}` },
      });
      assert.equal(denied.status, 403, `Expected 403 but got ${denied.status}: ${JSON.stringify(denied.body)}`);
      assert.ok(denied.body.error);
    } finally {
      if (originalBypass === undefined) {
        delete process.env.LOCALHOST_BYPASS;
      } else {
        process.env.LOCALHOST_BYPASS = originalBypass;
      }
    }
  });

  test('GET /api/images?q=slug – search returns matching images', async () => {
    // Get the slug of the uploaded image to search for it
    const listR = await request('GET', '/api/images');
    const slug = listR.body[0].slug;
    const partial = slug.substring(0, 8); // first 8 chars of UUID

    const r = await request('GET', `/api/images?q=${partial}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 1, 'should find the image by partial slug');
  });

  test('GET /api/images?q=nonexistent – search returns empty', async () => {
    const r = await request('GET', '/api/images?q=zzz-definitely-not-a-slug-zzz');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.equal(r.body.length, 0, 'should return empty for non-matching query');
  });

  test('POST /api/images/download – downloads zip of selected images', async () => {
    const listR = await request('GET', '/api/images');
    assert.ok(listR.body.length >= 1);
    const imageId = listR.body[0].id;

    const r = await request('POST', '/api/images/download', {
      body: { ids: [imageId] },
    });
    assert.equal(r.status, 200, `Expected 200 but got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test('POST /api/images/download – empty ids returns 400', async () => {
    const r = await request('POST', '/api/images/download', {
      body: { ids: [] },
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  test('POST /api/images/download – invalid ids returns 400', async () => {
    const r = await request('POST', '/api/images/download', {
      body: { ids: ['abc', -1] },
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  test('GET /i/:slug – serving uploaded image returns 200', async () => {
    // First, get the slug of the image we uploaded
    const listR = await request('GET', '/api/images');
    assert.equal(listR.status, 200);
    assert.ok(listR.body.length >= 1);
    const slug = listR.body[0].slug;

    const r = await request('GET', `/i/${slug}`);
    assert.equal(r.status, 200, `Expected 200 but got ${r.status}`);
  });

  test('GET /i/nonexistent-slug – returns 404', async () => {
    const r = await request('GET', '/i/nonexistent-slug-that-does-not-exist');
    assert.equal(r.status, 404);
  });

  test('GET /api/images/99999 – non-existent image returns 404', async () => {
    const r = await request('GET', '/api/images/99999', { cookies: sessionCookie });
    assert.equal(r.status, 404);
    assert.ok(r.body.error);
  });

  test('DELETE /api/images/99999 – non-existent image returns 404', async () => {
    const r = await request('DELETE', '/api/images/99999', { cookies: sessionCookie });
    assert.equal(r.status, 404);
    assert.ok(r.body.error);
  });

  test('GET /nonexistent-route – returns 404 JSON', async () => {
    const r = await request('GET', '/api/this-does-not-exist');
    assert.equal(r.status, 404);
    assert.ok(r.body.error);
  });

  test('POST /api/images/check-hash – returns 200 for unique file', async () => {
    const r = await request('POST', '/api/images/check-hash', { body: { fileHash: 'abc123def456' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.isDuplicate, false);
    assert.ok(r.body.message);
  });

  test('POST /api/images/check-hash – includes descriptive error message', async () => {
    // Simply verify the message format
    const r = await request('POST', '/api/images/check-hash', { body: { fileHash: 'test-hash-xyz' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.isDuplicate, false);
    assert.match(r.body.message, /unique/i);
  });

  // ── Upload with visibility/expiration ─────────────────────────────────────
  test('POST /api/images/upload – accepts visibility and expiresAt fields', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const r = await uploadRequest('/api/images/upload', 'vis-test.png', tinyPng, 'image/png', {
      fields: { visibility: 'unlisted', expiresAt: futureDate },
    });
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.visibility, 'unlisted');
    assert.ok(r.body.expiresAt);
  });

  // ── Visibility PATCH ──────────────────────────────────────────────────────
  test('PATCH /api/images/:id/visibility – updates visibility', async () => {
    const listR = await request('GET', '/api/images');
    const image = listR.body[0];

    const r = await request('PATCH', `/api/images/${image.id}/visibility`, {
      body: { visibility: 'private' },
    });
    assert.equal(r.status, 200, `Expected 200 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.visibility, 'private');

    // Reset to public
    await request('PATCH', `/api/images/${image.id}/visibility`, {
      body: { visibility: 'public' },
    });
  });

  test('PATCH /api/images/:id/visibility – invalid value defaults to public', async () => {
    const listR = await request('GET', '/api/images');
    const image = listR.body[0];

    const r = await request('PATCH', `/api/images/${image.id}/visibility`, {
      body: { visibility: 'invalid-value' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.visibility, 'public');
  });

  // ── Expiration PATCH ──────────────────────────────────────────────────────
  test('PATCH /api/images/:id/expiration – updates expiration', async () => {
    const listR = await request('GET', '/api/images');
    const image = listR.body[0];
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const r = await request('PATCH', `/api/images/${image.id}/expiration`, {
      body: { expiresAt: futureDate },
    });
    assert.equal(r.status, 200, `Expected 200 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.expiresAt);

    // Clear expiration
    await request('PATCH', `/api/images/${image.id}/expiration`, {
      body: { expiresAt: null },
    });
  });

  // ── Serving private images ────────────────────────────────────────────────
  test('GET /i/:slug – private image returns 404 for unauthenticated user', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );
    const r = await uploadRequest('/api/images/upload', 'private-test.png', tinyPng, 'image/png', {
      fields: { visibility: 'private' },
    });
    assert.equal(r.status, 201);

    // Access without session (from localhost, which auto-assigns admin user
    // but the serve route checks session.userId, so we need to disable bypass)
    const originalBypass = process.env.LOCALHOST_BYPASS;
    process.env.LOCALHOST_BYPASS = 'false';
    try {
      const serveR = await request('GET', `/i/${r.body.slug}`);
      assert.equal(serveR.status, 404, 'private image should return 404 without auth');
    } finally {
      if (originalBypass === undefined) {
        delete process.env.LOCALHOST_BYPASS;
      } else {
        process.env.LOCALHOST_BYPASS = originalBypass;
      }
    }
  });

  // ── Expired image serving ─────────────────────────────────────────────────
  test('GET /i/:slug – expired image returns 410', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );
    // Upload normally first (parseExpiresAt rejects past dates during upload)
    const r = await uploadRequest('/api/images/upload', 'expired-test.png', tinyPng, 'image/png');
    assert.equal(r.status, 201);

    // Set expiration to the past via direct DB call
    const dbHttp = await import('../db/index.js');
    await dbHttp.updateImageExpiration(r.body.id, new Date(Date.now() - 60000).toISOString());

    const serveR = await request('GET', `/i/${r.body.slug}`);
    assert.equal(serveR.status, 410, 'expired image should return 410 Gone');
  });

  // ── Albums API (need session for auth) ────────────────────────────────────
  let albumSessionCookie = '';
  test('POST /api/albums – creates album', async () => {
    // Login to get session cookie for album tests
    const loginR = await request('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'AdminPass1!' },
    });
    albumSessionCookie = loginR.cookies.map(c => c.split(';')[0]).join('; ');

    const r = await request('POST', '/api/albums', {
      cookies: albumSessionCookie,
      body: { name: 'HTTP Test Album', description: 'Created in tests' },
    });
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.id);
    assert.equal(r.body.name, 'HTTP Test Album');
  });

  test('GET /api/albums – lists albums', async () => {
    const r = await request('GET', '/api/albums', { cookies: albumSessionCookie });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 1);
  });

  test('GET /api/albums/:id – returns album with images', async () => {
    const listR = await request('GET', '/api/albums', { cookies: albumSessionCookie });
    const album = listR.body[0];

    const r = await request('GET', `/api/albums/${album.id}`, { cookies: albumSessionCookie });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, album.name);
    assert.ok(Array.isArray(r.body.images));
  });

  test('POST /api/albums/:id/images – adds images to album', async () => {
    const listR = await request('GET', '/api/albums', { cookies: albumSessionCookie });
    const album = listR.body[0];
    const imagesR = await request('GET', '/api/images');
    const imageId = imagesR.body[0].id;

    const r = await request('POST', `/api/albums/${album.id}/images`, {
      cookies: albumSessionCookie,
      body: { imageIds: [imageId] },
    });
    assert.equal(r.status, 200);

    // Verify image was added
    const albumR = await request('GET', `/api/albums/${album.id}`, { cookies: albumSessionCookie });
    assert.ok(albumR.body.images.some(i => i.id === imageId));
  });

  test('DELETE /api/albums/:id/images/:imageId – removes image from album', async () => {
    const listR = await request('GET', '/api/albums', { cookies: albumSessionCookie });
    const album = listR.body[0];
    const albumR = await request('GET', `/api/albums/${album.id}`, { cookies: albumSessionCookie });
    const imageId = albumR.body.images[0].id;

    const r = await request('DELETE', `/api/albums/${album.id}/images/${imageId}`, { cookies: albumSessionCookie });
    assert.equal(r.status, 200);
  });

  test('PATCH /api/albums/:id – updates album', async () => {
    const listR = await request('GET', '/api/albums', { cookies: albumSessionCookie });
    const album = listR.body[0];

    const r = await request('PATCH', `/api/albums/${album.id}`, {
      cookies: albumSessionCookie,
      body: { name: 'Updated Album Name' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Updated Album Name');
  });

  test('DELETE /api/albums/:id – deletes album', async () => {
    // Create a disposable album to delete
    const createR = await request('POST', '/api/albums', {
      cookies: albumSessionCookie,
      body: { name: 'To Delete' },
    });
    assert.equal(createR.status, 201);
    const r = await request('DELETE', `/api/albums/${createR.body.id}`, { cookies: albumSessionCookie });
    assert.equal(r.status, 200);

    // Confirm it's gone
    const getR = await request('GET', `/api/albums/${createR.body.id}`, { cookies: albumSessionCookie });
    assert.equal(getR.status, 404);
  });

  test('GET /api/albums/999999 – non-existent album returns 404', async () => {
    const r = await request('GET', '/api/albums/999999');
    assert.equal(r.status, 404);
  });

  // ── Admin quota API ───────────────────────────────────────────────────────
  test('PATCH /api/admin/users/:id/quota – sets user quota', async () => {
    const usersR = await request('GET', '/api/admin/users');
    const userId = usersR.body[0].id;

    const r = await request('PATCH', `/api/admin/users/${userId}/quota`, {
      body: { quotaBytes: 52428800 }, // 50 MB
    });
    assert.equal(r.status, 200, `Expected 200 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.quotaBytes, 52428800);
  });

  test('GET /api/admin/users/:id/quota – returns quota info', async () => {
    const usersR = await request('GET', '/api/admin/users');
    const userId = usersR.body[0].id;

    const r = await request('GET', `/api/admin/users/${userId}/quota`);
    assert.equal(r.status, 200);
    assert.equal(r.body.quotaBytes, 52428800);
    assert.equal(typeof r.body.usedBytes, 'number');
  });

  // ── TOTP 2FA API ──────────────────────────────────────────────────────────
  test('GET /api/auth/totp/status – returns disabled by default', async () => {
    // Re-use albumSessionCookie which was established from a login earlier
    const r = await request('GET', '/api/auth/totp/status', { cookies: albumSessionCookie });
    assert.equal(r.status, 200, `Expected 200 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.enabled, false);
  });

  test('POST /api/auth/totp/setup – returns secret and QR code', async () => {
    const r = await request('POST', '/api/auth/totp/setup', { cookies: albumSessionCookie });
    assert.equal(r.status, 200, `Expected 200 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.secret, 'should return secret');
    assert.ok(r.body.qrDataUrl, 'should return QR code data URI');
    assert.ok(r.body.uri, 'should return otpauth URL');
  });

  // ── Upload throttling tests ───────────────────────────────────────────────
  test('POST /api/images/upload – single upload succeeds (throttle regression)', async () => {
    const { _resetCountersForTesting } = await import('../middleware/uploadThrottle.js');
    _resetCountersForTesting();

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );
    const r = await uploadRequest('/api/images/upload', 'throttle-ok.png', tinyPng, 'image/png');
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.slug, 'throttle should not block a normal upload');
  });

  test('POST /api/images/upload – per-user throttle returns 429 after limit is exceeded', async () => {
    const { _resetCountersForTesting } = await import('../middleware/uploadThrottle.js');
    const originalMax = process.env.USER_UPLOAD_RATE_LIMIT_MAX;
    process.env.USER_UPLOAD_RATE_LIMIT_MAX = '2';
    _resetCountersForTesting();

    // Use an authenticated session so req.session.userId is set and the per-user
    // throttle actually tracks this user's upload count.
    const loginR = await request('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'AdminPass1!' },
    });
    const throttleCookie = loginR.cookies.map(c => c.split(';')[0]).join('; ');

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5K3A8AAAAASUVORK5CYII=',
      'base64'
    );

    try {
      const r1 = await uploadRequest('/api/images/upload', 'throttle-1.png', tinyPng, 'image/png', { cookies: throttleCookie });
      assert.equal(r1.status, 201, `First upload should succeed, got ${r1.status}: ${JSON.stringify(r1.body)}`);

      const r2 = await uploadRequest('/api/images/upload', 'throttle-2.png', tinyPng, 'image/png', { cookies: throttleCookie });
      assert.equal(r2.status, 201, `Second upload should succeed, got ${r2.status}: ${JSON.stringify(r2.body)}`);

      const r3 = await uploadRequest('/api/images/upload', 'throttle-3.png', tinyPng, 'image/png', { cookies: throttleCookie });
      assert.equal(r3.status, 429, `Third upload should be throttled, got ${r3.status}: ${JSON.stringify(r3.body)}`);
      assert.ok(r3.body.error, 'throttled response should include an error message');
    } finally {
      // Always restore state so subsequent tests are unaffected.
      if (originalMax === undefined) {
        delete process.env.USER_UPLOAD_RATE_LIMIT_MAX;
      } else {
        process.env.USER_UPLOAD_RATE_LIMIT_MAX = originalMax;
      }
      _resetCountersForTesting();
    }
  });

});

// ── Localhost bypass toggle tests ─────────────────────────────────────────────
describe('Localhost bypass toggle', () => {
  // isLocalhost reads process.env.LOCALHOST_BYPASS on every call,
  // so we only need to change the env var before calling the function.
  let isLocalhost;

  before(async () => {
    ({ isLocalhost } = await import('../middleware/requireAuth.js'));
  });

  test('isLocalhost returns false when LOCALHOST_BYPASS=false', () => {
    const original = process.env.LOCALHOST_BYPASS;
    process.env.LOCALHOST_BYPASS = 'false';

    const fakeReq = { ip: '127.0.0.1' };
    assert.equal(isLocalhost(fakeReq), false, 'isLocalhost should return false when bypass is disabled');

    // Restore
    if (original === undefined) {
      delete process.env.LOCALHOST_BYPASS;
    } else {
      process.env.LOCALHOST_BYPASS = original;
    }
  });

  test('isLocalhost returns true when LOCALHOST_BYPASS is unset', () => {
    const original = process.env.LOCALHOST_BYPASS;
    delete process.env.LOCALHOST_BYPASS;

    const fakeReq = { ip: '127.0.0.1' };
    assert.equal(isLocalhost(fakeReq), true, 'isLocalhost should return true when bypass is enabled by default');

    // Restore
    if (original !== undefined) {
      process.env.LOCALHOST_BYPASS = original;
    }
  });

  test('isLocalhost returns false for non-localhost IP regardless of setting', () => {
    const original = process.env.LOCALHOST_BYPASS;
    delete process.env.LOCALHOST_BYPASS;

    const fakeReq = { ip: '192.168.1.100' };
    assert.equal(isLocalhost(fakeReq), false, 'isLocalhost should return false for non-localhost IP');

    if (original !== undefined) {
      process.env.LOCALHOST_BYPASS = original;
    }
  });
});
