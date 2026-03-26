import bcrypt from 'bcrypt';
import BaseAdapter from '../BaseAdapter.js';

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
      ({ Pool } = await import('pg'));
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
        email TEXT,
        real_name TEXT,
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
        file_hash TEXT,
        comment TEXT,
        tags TEXT,
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

      CREATE TABLE IF NOT EXISTS api_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        label TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS content_flags (
        id SERIAL PRIMARY KEY,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        flag_type TEXT NOT NULL,
        reason TEXT NOT NULL,
        reporter_name TEXT,
        reporter_email TEXT,
        reporter_country TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS flag_resolutions (
        id SERIAL PRIMARY KEY,
        flag_id INTEGER NOT NULL REFERENCES content_flags(id) ON DELETE CASCADE,
        admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        notes TEXT,
        evidence_url TEXT,
        resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_images_slug ON images(slug);
      CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id);
      CREATE INDEX IF NOT EXISTS idx_views_image ON image_views(image_id);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_flags_image ON content_flags(image_id);
      CREATE INDEX IF NOT EXISTS idx_flags_status ON content_flags(status);
      CREATE INDEX IF NOT EXISTS idx_flags_created ON content_flags(created_at);
      CREATE INDEX IF NOT EXISTS idx_resolutions_flag ON flag_resolutions(flag_id);
    `);

    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name TEXT');
    await client.query('ALTER TABLE images ADD COLUMN IF NOT EXISTS comment TEXT');
    await client.query('ALTER TABLE images ADD COLUMN IF NOT EXISTS tags TEXT');
    await client.query('ALTER TABLE images ADD COLUMN IF NOT EXISTS file_hash TEXT');
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users (LOWER(email))
      WHERE email IS NOT NULL AND email <> ''
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_images_file_hash ON images(file_hash)');
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

  async createUser(username, plainPassword, isAdmin = false, profile = {}) {
    const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    const email = profile.email ? String(profile.email).trim().toLowerCase() : null;
    const realName = profile.realName ? String(profile.realName).trim() : null;
    const row = await this._queryOne(
      'INSERT INTO users (username, email, real_name, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, email, realName, hash, isAdmin ? 1 : 0]
    );
    return row.id;
  }

  async getUserByUsername(username) {
    return this._queryOne(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
  }

  async getUserByEmail(email) {
    return this._queryOne(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]
    );
  }

  async getUserById(id) {
    return this._queryOne(
      'SELECT id, username, email, real_name, is_admin, created_at FROM users WHERE id = $1', [id]
    );
  }

  async listUsers() {
    return this._queryAll(
      'SELECT id, username, email, real_name, is_admin, created_at FROM users ORDER BY created_at DESC'
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

  // ── API token helpers ────────────────────────────────────────────────────

  async createApiToken({ userId, tokenHash, label, expiresAt }) {
    const row = await this._queryOne(
      `INSERT INTO api_tokens (user_id, token_hash, label, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, tokenHash, label || null, expiresAt]
    );
    return row.id;
  }

  async getActiveApiTokenByHash(tokenHash) {
    return this._queryOne(
      `SELECT t.id, t.user_id, t.expires_at, u.username, u.is_admin
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
         AND t.revoked_at IS NULL
         AND t.expires_at > NOW()`,
      [tokenHash]
    );
  }

  async listApiTokensByUser(userId) {
    return this._queryAll(
      `SELECT id, label, expires_at, last_used_at, revoked_at, created_at
       FROM api_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
  }

  async revokeApiToken(userId, tokenId) {
    await this.pool.query(
      `UPDATE api_tokens
       SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [tokenId, userId]
    );
  }

  async touchApiTokenUsage(tokenId) {
    await this.pool.query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [tokenId]);
  }

  // ── Image helpers ─────────────────────────────────────────────────────────

  async createImage({ filename, originalName, slug, mimeType, size, userId, comment = null, tags = null, fileHash = null }) {
    const row = await this._queryOne(
      `INSERT INTO images (filename, original_name, slug, mime_type, size, file_hash, comment, tags, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [filename, originalName, slug, mimeType, size, fileHash, comment, tags, userId]
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

  async checkDuplicateHash(fileHash) {
    if (!fileHash) return null;
    return this._queryOne(
      `SELECT id, slug, original_name, user_id, created_at
       FROM images WHERE file_hash = $1
       LIMIT 1`,
      [fileHash]
    );
  }

  async getImagesByFileHash(fileHash) {
    if (!fileHash) return [];
    return this._queryAll(
      `SELECT id, slug, original_name, user_id, created_at
       FROM images WHERE file_hash = $1
       ORDER BY created_at DESC`,
      [fileHash]
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

  async getViewsOverTime(imageId, days = 30, userId = null) {
    const hasImageFilter = Number.isInteger(imageId) && imageId > 0;
    const hasUserFilter = Number.isInteger(userId) && userId > 0;

    if (hasUserFilter) {
      if (hasImageFilter) {
        return this._queryAll(
          `SELECT DATE(v.viewed_at) AS day, COUNT(*) AS views
           FROM image_views v
           JOIN images i ON i.id = v.image_id
           WHERE v.viewed_at >= NOW() - INTERVAL '1 day' * $1
             AND v.image_id = $2
             AND i.user_id = $3
           GROUP BY day
           ORDER BY day`,
          [days, imageId, userId]
        );
      }

      return this._queryAll(
        `SELECT DATE(v.viewed_at) AS day, COUNT(*) AS views
         FROM image_views v
         JOIN images i ON i.id = v.image_id
         WHERE v.viewed_at >= NOW() - INTERVAL '1 day' * $1
           AND i.user_id = $2
         GROUP BY day
         ORDER BY day`,
        [days, userId]
      );
    }

    const base = `
      SELECT DATE(viewed_at) AS day, COUNT(*) AS views
      FROM image_views
      WHERE viewed_at >= NOW() - INTERVAL '1 day' * $1
    `;

    if (hasImageFilter) {
      return this._queryAll(
        base + ' AND image_id = $2 GROUP BY day ORDER BY day',
        [days, imageId]
      );
    }

    return this._queryAll(base + ' GROUP BY day ORDER BY day', [days]);
  }

  // ── Data export / import ──────────────────────────────────────────────────

  async exportData() {
    const users = await this._queryAll('SELECT * FROM users ORDER BY id');
    const images = await this._queryAll('SELECT * FROM images ORDER BY id');
    const imageViews = await this._queryAll('SELECT * FROM image_views ORDER BY id');
    const apiTokens = await this._queryAll('SELECT * FROM api_tokens ORDER BY id');
    return { users, images, image_views: imageViews, api_tokens: apiTokens };
  }

  async importData(data) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Clear existing data
      await client.query('DELETE FROM api_tokens');
      await client.query('DELETE FROM image_views');
      await client.query('DELETE FROM images');
      await client.query('DELETE FROM users');

      // Import users
      for (const u of data.users) {
        await client.query(
          `INSERT INTO users (id, username, email, real_name, password_hash, is_admin, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [u.id, u.username, u.email || null, u.real_name || null, u.password_hash, u.is_admin, u.created_at]
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
          `INSERT INTO images (id, filename, original_name, slug, mime_type, size, comment, tags, user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [img.id, img.filename, img.original_name, img.slug,
           img.mime_type, img.size, img.comment || null, img.tags || null, img.user_id, img.created_at]
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

      for (const t of (data.api_tokens || [])) {
        await client.query(
          `INSERT INTO api_tokens (id, user_id, token_hash, label, expires_at, last_used_at, revoked_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            t.id,
            t.user_id,
            t.token_hash,
            t.label || null,
            t.expires_at,
            t.last_used_at || null,
            t.revoked_at || null,
            t.created_at,
          ]
        );
      }
      if ((data.api_tokens || []).length > 0) {
        const maxId = Math.max(...data.api_tokens.map(t => t.id));
        await client.query(`SELECT setval('api_tokens_id_seq', $1)`, [maxId]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Content Flagging helpers ──────────────────────────────────────────────

  async createContentFlag({ imageId, flagType, reason, reporterName = null, reporterEmail = null, reporterCountry = null }) {
    const result = await this._queryOne(
      `INSERT INTO content_flags (image_id, flag_type, reason, reporter_name, reporter_email, reporter_country)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [imageId, flagType, reason, reporterName, reporterEmail, reporterCountry]
    );
    return result.id;
  }

  async getContentFlag(flagId) {
    return this._queryOne(
      `SELECT f.*, i.slug, i.original_name, u.username
       FROM content_flags f
       JOIN images i ON i.id = f.image_id
       JOIN users u ON u.id = i.user_id
       WHERE f.id = $1`,
      [flagId]
    );
  }

  async listContentFlags({ status = null, imageId = null, limit = 50, offset = 0 } = {}) {
    let query = 
      `SELECT f.id, f.image_id, f.flag_type, f.reason, f.reporter_name, f.reporter_country,
              f.status, f.created_at, i.slug, i.original_name, u.username,
              COUNT(res.id)::int as resolution_count
       FROM content_flags f
       JOIN images i ON i.id = f.image_id
       JOIN users u ON u.id = i.user_id
       LEFT JOIN flag_resolutions res ON res.flag_id = f.id
       WHERE 1=1`;
    
    const params = [];
    let paramIdx = 1;
    if (status) {
      query += ` AND f.status = $${paramIdx++}`;
      params.push(status);
    }
    if (imageId) {
      query += ` AND f.image_id = $${paramIdx++}`;
      params.push(imageId);
    }
    
    query += ` GROUP BY f.id ORDER BY f.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);
    
    return this._queryAll(query, params);
  }

  async getFlagCountByStatus() {
    return this._queryAll(
      `SELECT status, COUNT(*)::int as count
       FROM content_flags
       GROUP BY status`,
      []
    );
  }

  async updateFlagStatus(flagId, newStatus) {
    return this._queryOne(
      `UPDATE content_flags SET status = $1 WHERE id = $2 RETURNING id`,
      [newStatus, flagId]
    );
  }

  async createFlagResolution({ flagId, adminId = null, action, notes = null, evidenceUrl = null }) {
    const result = await this._queryOne(
      `INSERT INTO flag_resolutions (flag_id, admin_id, action, notes, evidence_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [flagId, adminId, action, notes, evidenceUrl]
    );
    return result.id;
  }

  async getFlagResolutions(flagId) {
    return this._queryAll(
      `SELECT r.*, u.username as admin_username
       FROM flag_resolutions r
       LEFT JOIN users u ON u.id = r.admin_id
       WHERE r.flag_id = $1
       ORDER BY r.resolved_at DESC`,
      [flagId]
    );
  }

  async getFlagWithResolutions(flagId) {
    const flag = await this.getContentFlag(flagId);
    if (!flag) return null;
    const resolutions = await this.getFlagResolutions(flagId);
    return { ...flag, resolutions };
  }
}

export default PostgresAdapter;
