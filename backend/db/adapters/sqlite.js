'use strict';

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const BaseAdapter = require('../BaseAdapter');

const SALT_ROUNDS = 12;

class SqliteAdapter extends BaseAdapter {
  constructor() {
    super();
    this.db = null;
  }

  async init(config) {
    const dbPath = typeof config === 'string' ? config : config.path;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        email TEXT,
        real_name TEXT,
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
        comment TEXT,
        tags TEXT,
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

    // Backward-compatible migration for existing DB files.
    const userCols = this.db.prepare("PRAGMA table_info(users)").all();
    const hasEmail = userCols.some(c => c.name === 'email');
    const hasRealName = userCols.some(c => c.name === 'real_name');
    if (!hasEmail) {
      this.db.exec('ALTER TABLE users ADD COLUMN email TEXT');
    }
    if (!hasRealName) {
      this.db.exec('ALTER TABLE users ADD COLUMN real_name TEXT');
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(LOWER(email))
      WHERE email IS NOT NULL AND email <> '';
    `);

    const imageCols = this.db.prepare("PRAGMA table_info(images)").all();
    const hasComment = imageCols.some(c => c.name === 'comment');
    const hasTags = imageCols.some(c => c.name === 'tags');
    if (!hasComment) {
      this.db.exec('ALTER TABLE images ADD COLUMN comment TEXT');
    }
    if (!hasTags) {
      this.db.exec('ALTER TABLE images ADD COLUMN tags TEXT');
    }

    return this;
  }

  async close() {
    if (this.db) this.db.close();
  }

  /** Return the raw better-sqlite3 instance (for advanced use / migration). */
  getRawDB() {
    return this.db;
  }

  // ── User helpers ──────────────────────────────────────────────────────────

  async createUser(username, plainPassword, isAdmin = false, profile = {}) {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    const email = profile.email ? String(profile.email).trim().toLowerCase() : null;
    const realName = profile.realName ? String(profile.realName).trim() : null;
    const stmt = this.db.prepare(
      'INSERT INTO users (username, email, real_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)'
    );
    const result = stmt.run(username, email, realName, hash, isAdmin ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  async getUserByUsername(username) {
    return this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username);
  }

  async getUserByEmail(email) {
    return this.db
      .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)')
      .get(email);
  }

  async getUserById(id) {
    return this.db
      .prepare('SELECT id, username, email, real_name, is_admin, created_at FROM users WHERE id = ?')
      .get(id);
  }

  async listUsers() {
    return this.db
      .prepare('SELECT id, username, email, real_name, is_admin, created_at FROM users ORDER BY created_at DESC')
      .all();
  }

  async deleteUser(id) {
    return this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  async updateUserPassword(id, plainPassword) {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    return this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hash, id);
  }

  async verifyPassword(plainPassword, hash) {
    return bcrypt.compare(plainPassword, hash);
  }

  // ── Image helpers ─────────────────────────────────────────────────────────

  async createImage({ filename, originalName, slug, mimeType, size, userId, comment = null, tags = null }) {
    const stmt = this.db.prepare(
      `INSERT INTO images (filename, original_name, slug, mime_type, size, comment, tags, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(filename, originalName, slug, mimeType, size, comment, tags, userId);
    return Number(result.lastInsertRowid);
  }

  async getImageBySlug(slug) {
    return this.db
      .prepare('SELECT * FROM images WHERE slug = ?')
      .get(slug);
  }

  async getImageById(id) {
    return this.db
      .prepare('SELECT * FROM images WHERE id = ?')
      .get(id);
  }

  async listImagesByUser(userId) {
    return this.db
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

  async listAllImages() {
    return this.db
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

  async deleteImage(id) {
    return this.db.prepare('DELETE FROM images WHERE id = ?').run(id);
  }

  async slugExists(slug) {
    const row = this.db
      .prepare('SELECT 1 FROM images WHERE slug = ?')
      .get(slug);
    return !!row;
  }

  async searchImages(query, userId, isAdmin) {
    const pattern = `%${query}%`;
    if (isAdmin) {
      return this.db
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
    return this.db
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

  async getImagesByIds(ids) {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
      .all(...ids);
  }

  // ── View / stats helpers ──────────────────────────────────────────────────

  async recordView(imageId, ipAddress, referrer) {
    this.db
      .prepare(
        'INSERT INTO image_views (image_id, ip_address, referrer) VALUES (?, ?, ?)'
      )
      .run(imageId, ipAddress || null, referrer || null);
  }

  async getImageStats(userId) {
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
      ? this.db.prepare(query).all(userId)
      : this.db.prepare(query).all();
  }

  async getViewsOverTime(imageId, days = 30) {
    const base = `
      SELECT date(viewed_at) AS day, COUNT(*) AS views
      FROM image_views
      WHERE viewed_at >= datetime('now', '-' || ? || ' days')
    `;

    if (imageId) {
      return this.db
        .prepare(base + ' AND image_id = ? GROUP BY day ORDER BY day')
        .all(days, imageId);
    }
    return this.db
      .prepare(base + ' GROUP BY day ORDER BY day')
      .all(days);
  }

  // ── Data export / import ──────────────────────────────────────────────────

  async exportData() {
    const users = this.db.prepare('SELECT * FROM users').all();
    const images = this.db.prepare('SELECT * FROM images').all();
    const imageViews = this.db.prepare('SELECT * FROM image_views').all();
    return { users, images, image_views: imageViews };
  }

  async importData(data) {
    const trx = this.db.transaction(() => {
      // Clear existing data (order matters for foreign keys)
      this.db.prepare('DELETE FROM image_views').run();
      this.db.prepare('DELETE FROM images').run();
      this.db.prepare('DELETE FROM users').run();

      // Import users (preserving original IDs and password hashes)
      const insertUser = this.db.prepare(
        `INSERT INTO users (id, username, email, real_name, password_hash, is_admin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const u of data.users) {
        insertUser.run(
          u.id,
          u.username,
          u.email || null,
          u.real_name || null,
          u.password_hash,
          u.is_admin,
          u.created_at
        );
      }

      // Import images
      const insertImage = this.db.prepare(
        `INSERT INTO images (id, filename, original_name, slug, mime_type, size, comment, tags, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const img of data.images) {
        insertImage.run(
          img.id, img.filename, img.original_name, img.slug,
          img.mime_type, img.size, img.comment || null, img.tags || null, img.user_id, img.created_at
        );
      }

      // Import views
      const insertView = this.db.prepare(
        `INSERT INTO image_views (id, image_id, viewed_at, ip_address, referrer)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const v of data.image_views) {
        insertView.run(v.id, v.image_id, v.viewed_at, v.ip_address, v.referrer);
      }
    });
    trx();
  }
}

module.exports = SqliteAdapter;
