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
db.initDB(TEST_DB);

// ── DB unit tests ─────────────────────────────────────────────────────────────
describe('Database helpers', () => {
  test('createUser / getUserByUsername', () => {
    const id = db.createUser('testuser', 'Password1!', false);
    assert.ok(id > 0, 'should return an auto-increment id');

    const user = db.getUserByUsername('testuser');
    assert.equal(user.username, 'testuser');
    assert.equal(user.is_admin, 0);
  });

  test('verifyPassword – correct password', () => {
    const user = db.getUserByUsername('testuser');
    assert.ok(db.verifyPassword('Password1!', user.password_hash));
  });

  test('verifyPassword – wrong password', () => {
    const user = db.getUserByUsername('testuser');
    assert.equal(db.verifyPassword('wrong', user.password_hash), false);
  });

  test('getUserByUsername is case-insensitive', () => {
    const u = db.getUserByUsername('TESTUSER');
    assert.ok(u, 'should find user regardless of case');
  });

  test('createUser – duplicate username throws', () => {
    assert.throws(() => db.createUser('testuser', 'AnotherPass1!'), /UNIQUE/);
  });

  test('createImage / getImageBySlug / slugExists', () => {
    const userId = db.getUserByUsername('testuser').id;
    const imgId = db.createImage({
      filename: 'abc123.jpg',
      originalName: 'my-photo.jpg',
      slug: 'my-photo',
      mimeType: 'image/jpeg',
      size: 4096,
      userId,
    });
    assert.ok(imgId > 0);
    assert.ok(db.slugExists('my-photo'));
    assert.equal(db.slugExists('nonexistent'), false);

    const img = db.getImageBySlug('my-photo');
    assert.equal(img.slug, 'my-photo');
    assert.equal(img.size, 4096);
  });

  test('listImagesByUser', () => {
    const userId = db.getUserByUsername('testuser').id;
    const list = db.listImagesByUser(userId);
    assert.ok(list.length >= 1);
    assert.equal(list[0].user_id, userId);
  });

  test('recordView / getImageStats', () => {
    const userId = db.getUserByUsername('testuser').id;
    const img = db.getImageBySlug('my-photo');

    db.recordView(img.id, '1.2.3.4', 'https://github.com');
    db.recordView(img.id, '5.6.7.8', null);

    const stats = db.getImageStats(userId);
    const row = stats.find(s => s.slug === 'my-photo');
    assert.ok(row, 'stats row should exist');
    assert.equal(row.view_count, 2);
  });

  test('deleteImage removes record', () => {
    const userId = db.getUserByUsername('testuser').id;
    const imgId2 = db.createImage({
      filename: 'del.jpg',
      originalName: 'del.jpg',
      slug: 'to-delete',
      mimeType: 'image/jpeg',
      size: 100,
      userId,
    });
    db.deleteImage(imgId2);
    assert.equal(db.getImageBySlug('to-delete'), undefined);
  });

  test('listUsers / deleteUser', () => {
    db.createUser('tempuser', 'TempPass1!', false);
    const before = db.listUsers().length;
    const temp = db.getUserByUsername('tempuser');
    db.deleteUser(temp.id);
    const after = db.listUsers().length;
    assert.equal(after, before - 1);
  });

  test('updateUserPassword', () => {
    db.updateUserPassword(db.getUserByUsername('testuser').id, 'NewPass999!');
    const user = db.getUserByUsername('testuser');
    assert.ok(db.verifyPassword('NewPass999!', user.password_hash));
    assert.equal(db.verifyPassword('Password1!', user.password_hash), false);
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
    dbHttp.initDB(HTTP_DB);
    adminId = dbHttp.createUser('admin', 'AdminPass1!', true);
    dbHttp.createUser('regular', 'RegPass1!', false);

    server = require('../server');

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
  function uploadRequest(urlPath, filename, fileContent, mimeType, { cookies = '' } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, baseUrl);
      const boundary = '----TestBoundary' + Date.now();
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`
        ),
        fileContent,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

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

  test('GET /api/images – localhost without auth returns images', async () => {
    const r = await request('GET', '/api/images');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length >= 1, 'should contain at least the uploaded image');
  });
});
