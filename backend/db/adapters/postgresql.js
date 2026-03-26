'use strict';

const bcrypt = require('bcrypt');
const BaseAdapter = require('../BaseAdapter');

const SALT_ROUNDS = 12;

/**
 * PostgreSQL adapter.
 *
 * Requires the `pg` package to be installed:
 *   npm install pg
 *
 * Configuration via environment variables:
 *   DB_TYPE=postgresql
 *   DATABASE_URL=postgres://user:pass@host:5432/dbname
 *
 * Or individual variables:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 */
class PostgresAdapter extends BaseAdapter {
  constructor() {
    super();
    this.pool = null;
  }

  async init(config) {
    let Pool;
    try {
      ({ Pool } = require('pg'));
    } catch (_err) {
      throw new Error(
        'PostgreSQL adapter requires the "pg" package. Install it with:\n' +
        '  cd backend && npm install pg'
      );
    }

    // config can be a connection string or an options object
    if (typeof config === 'string') {
      this.pool = new Pool({ connectionString: config });
    } else {
      this.pool = new Pool(config);
    }

    // Test connectivity
    const client = await this.pool.connect();
    try {
      await this._ensureSchema(client);
    } finally {
      client.release();
    }

    return this;
  }

  async _ensureSchema(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS images (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS image_views (
        id SERIAL PRIMARY KEY,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip_address TEXT,
        referrer TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_images_slug ON images(slug);
      CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id);
      CREATE INDEX IF NOT EXISTS idx_views_image ON image_views(image_id);
    `);
  }

  async close() {
    if (this.pool) await this.pool.end();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async _queryOne(sql, params = []) {
    const { rows } = await this.pool.query(sql, params);
    return rows[0] || undefined;
  }

  async _queryAll(sql, params = []) {
    const { rows } = await this.pool.query(sql, params);
    return rows;
  }

  // ── User helpers ──────────────────────────────────────────────────────────

  async createUser(username, plainPassword, isAdmin = false) {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    const row = await this._queryOne(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id',
      [username, hash, isAdmin ? 1 : 0]
    );
    return row.id;
  }

  async getUserByUsername(username) {
    return this._queryOne(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
  }

  async getUserById(id) {
    return this._queryOne(
      'SELECT id, username, is_admin, created_at FROM users WHERE id = $1', [id]
    );
  }

  async listUsers() {
    return this._queryAll(
      'SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC'
    );
  }

  async deleteUser(id) {
    await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async updateUserPassword(id, plainPassword) {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    await this.pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]
    );
  }

  async verifyPassword(plainPassword, hash) {
    return bcrypt.compare(plainPassword, hash);
  }

  // ── Image helpers ─────────────────────────────────────────────────────────

  async createImage({ filename, originalName, slug, mimeType, size, userId }) {
    const row = await this._queryOne(
      `INSERT INTO images (filename, original_name, slug, mime_type, size, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [filename, originalName, slug, mimeType, size, userId]
    );
    return row.id;
  }

  async getImageBySlug(slug) {
    return this._queryOne('SELECT * FROM images WHERE slug = $1', [slug]);
  }

  async getImageById(id) {
    return this._queryOne('SELECT * FROM images WHERE id = $1', [id]);
  }

  async listImagesByUser(userId) {
    return this._queryAll(
      `SELECT i.*, COUNT(v.id) AS view_count
       FROM images i
       LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = $1
       GROUP BY i.id
       ORDER BY i.created_at DESC`,
      [userId]
    );
  }

  async listAllImages() {
    return this._queryAll(
      `SELECT i.*, u.username, COUNT(v.id) AS view_count
       FROM images i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id, u.username
       ORDER BY i.created_at DESC`
    );
  }

  async deleteImage(id) {
    await this.pool.query('DELETE FROM images WHERE id = $1', [id]);
  }

  async slugExists(slug) {
    const row = await this._queryOne(
      'SELECT 1 FROM images WHERE slug = $1', [slug]
    );
    return !!row;
  }

  async searchImages(query, userId, isAdmin) {
    const pattern = `%${query}%`;
    if (isAdmin) {
      return this._queryAll(
        `SELECT i.*, u.username, COUNT(v.id) AS view_count
         FROM images i
         JOIN users u ON u.id = i.user_id
         LEFT JOIN image_views v ON v.image_id = i.id
         WHERE i.slug ILIKE $1 OR i.original_name ILIKE $2 OR u.username ILIKE $3
         GROUP BY i.id, u.username
         ORDER BY i.created_at DESC`,
        [pattern, pattern, pattern]
      );
    }
    return this._queryAll(
      `SELECT i.*, COUNT(v.id) AS view_count
       FROM images i
       LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = $1 AND (i.slug ILIKE $2 OR i.original_name ILIKE $3)
       GROUP BY i.id
       ORDER BY i.created_at DESC`,
      [userId, pattern, pattern]
    );
  }

  async getImagesByIds(ids) {
    if (!ids.length) return [];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    return this._queryAll(
      `SELECT * FROM images WHERE id IN (${placeholders})`,
      ids
    );
  }

  // ── View / stats helpers ──────────────────────────────────────────────────

  async recordView(imageId, ipAddress, referrer) {
    await this.pool.query(
      'INSERT INTO image_views (image_id, ip_address, referrer) VALUES ($1, $2, $3)',
      [imageId, ipAddress || null, referrer || null]
    );
  }

  async getImageStats(userId) {
    if (userId) {
      return this._queryAll(
        `SELECT i.id, i.slug, i.original_name, i.created_at,
                COUNT(v.id) AS view_count,
                MAX(v.viewed_at) AS last_viewed
         FROM images i
         LEFT JOIN image_views v ON v.image_id = i.id
         WHERE i.user_id = $1
         GROUP BY i.id
         ORDER BY view_count DESC`,
        [userId]
      );
    }
    return this._queryAll(
      `SELECT i.id, i.slug, i.original_name, i.created_at, u.username,
              COUNT(v.id) AS view_count,
              MAX(v.viewed_at) AS last_viewed
       FROM images i
       JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id, u.username
       ORDER BY view_count DESC`
    );
  }

  async getViewsOverTime(imageId, days = 30) {
    const base = `
      SELECT DATE(viewed_at) AS day, COUNT(*) AS views
      FROM image_views
      WHERE viewed_at >= NOW() - ($1 || ' days')::INTERVAL
    `;

    if (imageId) {
      return this._queryAll(
        base + ' AND image_id = $2 GROUP BY day ORDER BY day',
        [days, imageId]
      );
    }
    return this._queryAll(
      base + ' GROUP BY day ORDER BY day', [days]
    );
  }

  // ── Data export / import ──────────────────────────────────────────────────

  async exportData() {
    const users = await this._queryAll('SELECT * FROM users ORDER BY id');
    const images = await this._queryAll('SELECT * FROM images ORDER BY id');
    const imageViews = await this._queryAll('SELECT * FROM image_views ORDER BY id');
    return { users, images, image_views: imageViews };
  }

  async importData(data) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Clear existing data
      await client.query('DELETE FROM image_views');
      await client.query('DELETE FROM images');
      await client.query('DELETE FROM users');

      // Import users
      for (const u of data.users) {
        await client.query(
          `INSERT INTO users (id, username, password_hash, is_admin, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [u.id, u.username, u.password_hash, u.is_admin, u.created_at]
        );
      }
      // Reset sequence
      if (data.users.length > 0) {
        const maxId = Math.max(...data.users.map(u => u.id));
        await client.query(`SELECT setval('users_id_seq', $1)`, [maxId]);
      }

      // Import images
      for (const img of data.images) {
        await client.query(
          `INSERT INTO images (id, filename, original_name, slug, mime_type, size, user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [img.id, img.filename, img.original_name, img.slug,
           img.mime_type, img.size, img.user_id, img.created_at]
        );
      }
      if (data.images.length > 0) {
        const maxId = Math.max(...data.images.map(i => i.id));
        await client.query(`SELECT setval('images_id_seq', $1)`, [maxId]);
      }

      // Import views
      for (const v of data.image_views) {
        await client.query(
          `INSERT INTO image_views (id, image_id, viewed_at, ip_address, referrer)
           VALUES ($1, $2, $3, $4, $5)`,
          [v.id, v.image_id, v.viewed_at, v.ip_address, v.referrer]
        );
      }
      if (data.image_views.length > 0) {
        const maxId = Math.max(...data.image_views.map(v => v.id));
        await client.query(`SELECT setval('image_views_id_seq', $1)`, [maxId]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = PostgresAdapter;
