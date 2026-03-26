'use strict';

/**
 * Backend unit & integration tests using Node.js built-in test runner.
 * Run:  cd backend && node --test tests/
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// ── Test DB setup ─────────────────────────────────────────────────────────────
const TEST_DB = '/tmp/imghoster_test.db';
const TEST_UPLOADS = '/tmp/imghoster_test_uploads';

// Clean up before run
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
if (!fs.existsSync(TEST_UPLOADS)) fs.mkdirSync(TEST_UPLOADS, { recursive: true });

process.env.DB_PATH = TEST_DB;
process.env.SESSION_SECRET = 'test-session-secret-123';
process.env.UPLOADS_DIR = TEST_UPLOADS;
process.env.PORT = '0'; // random port
process.env.NODE_ENV = 'test';

const db = require('../db');

// ── DB unit tests ─────────────────────────────────────────────────────────────
describe('Database helpers', () => {
  before(async () => {
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
});

// ── HTTP integration tests ────────────────────────────────────────────────────
describe('HTTP API', () => {
  let app, server, baseUrl, adminId;

  before(async () => {
    // Create a second test DB for HTTP tests to avoid cross-contamination
    const HTTP_DB = '/tmp/imghoster_http_test.db';
    if (fs.existsSync(HTTP_DB)) fs.unlinkSync(HTTP_DB);
    process.env.DB_PATH = HTTP_DB;

    const dbHttp = require('../db');
    await dbHttp.initDB(HTTP_DB);
    adminId = await dbHttp.createUser('admin', 'AdminPass1!', true);
    await dbHttp.createUser('regular', 'RegPass1!', false);

    // server.js now exports a Promise that resolves to the server
    server = await require('../server');

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
    // Create a minimal valid JPEG (smallest valid JPEG is ~107 bytes)
    const jpegHeader = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ]);

    const r = await uploadRequest('/api/images/upload', 'test.jpg', jpegHeader, 'image/jpeg');
    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.id, 'should return image id');
    assert.ok(r.body.slug, 'should return slug');
    assert.ok(r.body.url, 'should return url');
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
    const jpegHeader = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ]);

    const r = await uploadRequestMulti('/api/images/upload', [
      { filename: 'multi-1.png', content: tinyPng, mimeType: 'image/png' },
      { filename: 'multi-2.jpg', content: jpegHeader, mimeType: 'image/jpeg' },
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
    const jpegHeader = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
    ]);
    const webpStub = Buffer.from('RIFF0000WEBPVP8 ', 'ascii');

    const r = await uploadRequestMulti('/api/images/upload', [
      { filename: 'mixed-1.jpg', content: jpegHeader, mimeType: 'image/jpeg' },
      { filename: 'mixed-2.png', content: tinyPng, mimeType: 'image/png' },
      { filename: 'mixed-3.webp', content: webpStub, mimeType: 'image/webp' },
    ]);

    assert.equal(r.status, 201, `Expected 201 but got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body.uploaded), 'should return uploaded array for mixed multi-upload');
    assert.equal(r.body.uploaded.length, 3);
    assert.ok(r.body.uploaded.every(item => typeof item.url === 'string' && item.url.includes('/i/')));
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
});

// ── Localhost bypass toggle tests ─────────────────────────────────────────────
describe('Localhost bypass toggle', () => {
  // isLocalhost reads process.env.LOCALHOST_BYPASS on every call,
  // so we only need to change the env var before calling the function.
  const { isLocalhost } = require('../middleware/requireAuth');

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
