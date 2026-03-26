'use strict';

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const SALT_ROUNDS = 12;

let db;

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

function initDB(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS image_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_id INTEGER NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip_address TEXT,
      referrer TEXT,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_images_slug ON images(slug);
    CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id);
    CREATE INDEX IF NOT EXISTS idx_views_image ON image_views(image_id);
  `);

  return db;
}

// ── User helpers ──────────────────────────────────────────────────────────────

function createUser(username, plainPassword, isAdmin = false) {
  const hash = bcrypt.hashSync(plainPassword, SALT_ROUNDS);
  const stmt = getDB().prepare(
    'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)'
  );
  const result = stmt.run(username, hash, isAdmin ? 1 : 0);
  return result.lastInsertRowid;
}

function getUserByUsername(username) {
  return getDB()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username);
}

function getUserById(id) {
  return getDB()
    .prepare('SELECT id, username, is_admin, created_at FROM users WHERE id = ?')
    .get(id);
}

function listUsers() {
  return getDB()
    .prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC')
    .all();
}

function deleteUser(id) {
  return getDB().prepare('DELETE FROM users WHERE id = ?').run(id);
}

function updateUserPassword(id, plainPassword) {
  const hash = bcrypt.hashSync(plainPassword, SALT_ROUNDS);
  return getDB()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hash, id);
}

function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function createImage({ filename, originalName, slug, mimeType, size, userId }) {
  const stmt = getDB().prepare(
    `INSERT INTO images (filename, original_name, slug, mime_type, size, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(filename, originalName, slug, mimeType, size, userId);
  return result.lastInsertRowid;
}

function getImageBySlug(slug) {
  return getDB()
    .prepare('SELECT * FROM images WHERE slug = ?')
    .get(slug);
}

function getImageById(id) {
  return getDB()
    .prepare('SELECT * FROM images WHERE id = ?')
    .get(id);
}

function listImagesByUser(userId) {
  return getDB()
    .prepare(
      `SELECT i.*, COUNT(v.id) AS view_count
       FROM images i
       LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = ?
       GROUP BY i.id
       ORDER BY i.created_at DESC`
    )
    .all(userId);
}

function listAllImages() {
  return getDB()
    .prepare(
      `SELECT i.*, u.username, COUNT(v.id) AS view_count
       FROM images i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id
       ORDER BY i.created_at DESC`
    )
    .all();
}

function deleteImage(id) {
  return getDB().prepare('DELETE FROM images WHERE id = ?').run(id);
}

function slugExists(slug) {
  const row = getDB()
    .prepare('SELECT 1 FROM images WHERE slug = ?')
    .get(slug);
  return !!row;
}

function searchImages(query, userId, isAdmin) {
  const pattern = `%${query}%`;
  if (isAdmin) {
    return getDB()
      .prepare(
        `SELECT i.*, u.username, COUNT(v.id) AS view_count
         FROM images i
         JOIN users u ON u.id = i.user_id
         LEFT JOIN image_views v ON v.image_id = i.id
         WHERE i.slug LIKE ? OR i.original_name LIKE ? OR u.username LIKE ?
         GROUP BY i.id
         ORDER BY i.created_at DESC`
      )
      .all(pattern, pattern, pattern);
  }
  return getDB()
    .prepare(
      `SELECT i.*, COUNT(v.id) AS view_count
       FROM images i
       LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = ? AND (i.slug LIKE ? OR i.original_name LIKE ?)
       GROUP BY i.id
       ORDER BY i.created_at DESC`
    )
    .all(userId, pattern, pattern);
}

function getImagesByIds(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return getDB()
    .prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
    .all(...ids);
}

// ── View / stats helpers ──────────────────────────────────────────────────────

function recordView(imageId, ipAddress, referrer) {
  getDB()
    .prepare(
      'INSERT INTO image_views (image_id, ip_address, referrer) VALUES (?, ?, ?)'
    )
    .run(imageId, ipAddress || null, referrer || null);
}

function getImageStats(userId) {
  const query = userId
    ? `SELECT i.id, i.slug, i.original_name, i.created_at,
              COUNT(v.id) AS view_count,
              MAX(v.viewed_at) AS last_viewed
       FROM images i
       LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = ?
       GROUP BY i.id
       ORDER BY view_count DESC`
    : `SELECT i.id, i.slug, i.original_name, i.created_at, u.username,
              COUNT(v.id) AS view_count,
              MAX(v.viewed_at) AS last_viewed
       FROM images i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id
       ORDER BY view_count DESC`;

  return userId
    ? getDB().prepare(query).all(userId)
    : getDB().prepare(query).all();
}

function getViewsOverTime(imageId, days = 30) {
  const param = imageId
    ? { imageId, days }
    : { days };

  const base = `
    SELECT date(viewed_at) AS day, COUNT(*) AS views
    FROM image_views
    WHERE viewed_at >= datetime('now', '-' || ? || ' days')
  `;

  if (imageId) {
    return getDB()
      .prepare(base + ' AND image_id = ? GROUP BY day ORDER BY day')
      .all(days, imageId);
  }
  return getDB()
    .prepare(base + ' GROUP BY day ORDER BY day')
    .all(days);
}

module.exports = {
  initDB,
  getDB,
  createUser,
  getUserByUsername,
  getUserById,
  listUsers,
  deleteUser,
  updateUserPassword,
  verifyPassword,
  createImage,
  getImageBySlug,
  getImageById,
  listImagesByUser,
  listAllImages,
  deleteImage,
  slugExists,
  searchImages,
  getImagesByIds,
  recordView,
  getImageStats,
  getViewsOverTime,
};
