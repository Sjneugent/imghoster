import bcrypt from 'bcrypt';
import BaseAdapter from '../BaseAdapter.js';
const SALT_ROUNDS = 12;
class PostgresAdapter extends BaseAdapter {
    pool;
    constructor() {
        super();
        this.pool = null;
    }
    getPool() {
        if (!this.pool)
            throw new Error('Database not initialized');
        return this.pool;
    }
    async init(config) {
        let Pool;
        try {
            ({ Pool } = await import('pg'));
        }
        catch {
            throw new Error('PostgreSQL adapter requires the "pg" package. Install it with:\n' +
                '  cd backend && npm install pg');
        }
        if (typeof config === 'string') {
            this.pool = new Pool({ connectionString: config });
        }
        else {
            this.pool = new Pool(config);
        }
        const client = await this.pool.connect();
        try {
            await this._ensureSchema(client);
        }
        finally {
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
        storage_backend TEXT NOT NULL DEFAULT 'file',
        file_hash TEXT,
        comment TEXT,
        tags TEXT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS image_blobs (
        image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
        blob_data BYTEA NOT NULL,
        blob_size INTEGER NOT NULL,
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
        await client.query("ALTER TABLE images ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'file'");
        await client.query("ALTER TABLE images ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'");
        await client.query('ALTER TABLE images ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT NOT NULL DEFAULT 0');
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users (LOWER(email))
      WHERE email IS NOT NULL AND email <> ''
    `);
        await client.query('CREATE INDEX IF NOT EXISTS idx_images_file_hash ON images(file_hash)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_images_storage_backend ON images(storage_backend)');
        await client.query(`
      CREATE TABLE IF NOT EXISTS image_thumbnails (
        image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
        thumb_data BYTEA NOT NULL,
        thumb_size INTEGER NOT NULL,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS albums (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS album_images (
        album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (album_id, image_id)
      );

      CREATE TABLE IF NOT EXISTS totp_secrets (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id);
      CREATE INDEX IF NOT EXISTS idx_album_images_album ON album_images(album_id);
      CREATE INDEX IF NOT EXISTS idx_images_expires ON images(expires_at);
    `);
    }
    async close() {
        if (this.pool)
            await this.pool.end();
    }
    // ── Helpers ─────────────────────────────────────────────────────────────
    async _queryOne(sql, params = []) {
        const { rows } = await this.getPool().query(sql, params);
        return rows[0] || undefined;
    }
    async _queryAll(sql, params = []) {
        const { rows } = await this.getPool().query(sql, params);
        return rows;
    }
    // ── User helpers ──────────────────────────────────────────────────────────
    async createUser(username, plainPassword, isAdmin = false, profile = {}) {
        const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
        const email = profile.email ? String(profile.email).trim().toLowerCase() : null;
        const realName = profile.realName ? String(profile.realName).trim() : null;
        const row = await this._queryOne('INSERT INTO users (username, email, real_name, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id', [username, email, realName, hash, isAdmin ? 1 : 0]);
        return row.id;
    }
    async getUserByUsername(username) {
        return this._queryOne('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    }
    async getUserByEmail(email) {
        return this._queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    }
    async getUserById(id) {
        return this._queryOne('SELECT id, username, email, real_name, is_admin, created_at FROM users WHERE id = $1', [id]);
    }
    async listUsers() {
        return this._queryAll('SELECT id, username, email, real_name, is_admin, created_at FROM users ORDER BY created_at DESC');
    }
    async deleteUser(id) {
        const result = await this.getPool().query('DELETE FROM users WHERE id = $1', [id]);
        return { changes: result.rowCount ?? 0 };
    }
    async updateUserPassword(id, plainPassword) {
        const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
        const result = await this.getPool().query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
        return { changes: result.rowCount ?? 0 };
    }
    async verifyPassword(plainPassword, hash) {
        return bcrypt.compare(plainPassword, hash);
    }
    // ── API token helpers ────────────────────────────────────────────────────
    async createApiToken({ userId, tokenHash, label, expiresAt }) {
        const row = await this._queryOne(`INSERT INTO api_tokens (user_id, token_hash, label, expires_at) VALUES ($1, $2, $3, $4) RETURNING id`, [userId, tokenHash, label || null, expiresAt]);
        return row.id;
    }
    async getActiveApiTokenByHash(tokenHash) {
        return this._queryOne(`SELECT t.id, t.user_id, t.expires_at, u.username, u.is_admin
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1
         AND t.revoked_at IS NULL
         AND t.expires_at > NOW()`, [tokenHash]);
    }
    async listApiTokensByUser(userId) {
        return this._queryAll(`SELECT id, label, expires_at, last_used_at, revoked_at, created_at
       FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    }
    async revokeApiToken(userId, tokenId) {
        const result = await this.getPool().query(`UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [tokenId, userId]);
        return { changes: result.rowCount ?? 0 };
    }
    async touchApiTokenUsage(tokenId) {
        const result = await this.getPool().query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [tokenId]);
        return { changes: result.rowCount ?? 0 };
    }
    // ── Image helpers ─────────────────────────────────────────────────────────
    async createImage({ filename, originalName, slug, mimeType, size, userId, comment = null, tags = null, fileHash = null, storageBackend = 'file', visibility = 'public', expiresAt = null, }) {
        const row = await this._queryOne(`INSERT INTO images (filename, original_name, slug, mime_type, size, storage_backend, file_hash, comment, tags, user_id, visibility, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`, [filename, originalName, slug, mimeType, size, storageBackend, fileHash, comment, tags, userId, visibility, expiresAt]);
        return row.id;
    }
    async upsertImageBlob(imageId, blobData) {
        await this.getPool().query(`INSERT INTO image_blobs (image_id, blob_data, blob_size) VALUES ($1, $2, $3)
       ON CONFLICT (image_id) DO UPDATE SET blob_data = EXCLUDED.blob_data, blob_size = EXCLUDED.blob_size`, [imageId, blobData, blobData.length]);
    }
    async getImageBlobByImageId(imageId) {
        return this._queryOne('SELECT image_id, blob_data, blob_size, created_at FROM image_blobs WHERE image_id = $1', [imageId]);
    }
    async getImageBySlug(slug) {
        return this._queryOne('SELECT * FROM images WHERE slug = $1', [slug]);
    }
    async getImageById(id) {
        return this._queryOne('SELECT * FROM images WHERE id = $1', [id]);
    }
    async listImagesByUser(userId) {
        return this._queryAll(`SELECT i.*, COUNT(v.id) AS view_count
       FROM images i LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = $1 GROUP BY i.id ORDER BY i.created_at DESC`, [userId]);
    }
    async listAllImages() {
        return this._queryAll(`SELECT i.*, u.username, COUNT(v.id) AS view_count
       FROM images i JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id, u.username ORDER BY i.created_at DESC`);
    }
    async deleteImage(id) {
        const result = await this.getPool().query('DELETE FROM images WHERE id = $1', [id]);
        return { changes: result.rowCount ?? 0 };
    }
    async slugExists(slug) {
        const row = await this._queryOne('SELECT 1 FROM images WHERE slug = $1', [slug]);
        return !!row;
    }
    async searchImages(query, userId, isAdmin) {
        const pattern = `%${query}%`;
        if (isAdmin) {
            return this._queryAll(`SELECT i.*, u.username, COUNT(v.id) AS view_count
         FROM images i JOIN users u ON u.id = i.user_id
         LEFT JOIN image_views v ON v.image_id = i.id
         WHERE i.slug ILIKE $1 OR i.original_name ILIKE $2 OR u.username ILIKE $3
         GROUP BY i.id, u.username ORDER BY i.created_at DESC`, [pattern, pattern, pattern]);
        }
        return this._queryAll(`SELECT i.*, COUNT(v.id) AS view_count
       FROM images i LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = $1 AND (i.slug ILIKE $2 OR i.original_name ILIKE $3)
       GROUP BY i.id ORDER BY i.created_at DESC`, [userId, pattern, pattern]);
    }
    async getImagesByIds(ids) {
        if (!ids.length)
            return [];
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        return this._queryAll(`SELECT * FROM images WHERE id IN (${placeholders})`, ids);
    }
    async checkDuplicateHash(fileHash) {
        if (!fileHash)
            return null;
        return this._queryOne(`SELECT id, slug, original_name, user_id, created_at FROM images WHERE file_hash = $1 LIMIT 1`, [fileHash]);
    }
    async getImagesByFileHash(fileHash) {
        if (!fileHash)
            return [];
        return this._queryAll(`SELECT id, slug, original_name, user_id, created_at FROM images WHERE file_hash = $1 ORDER BY created_at DESC`, [fileHash]);
    }
    // ── View / stats helpers ──────────────────────────────────────────────────
    async recordView(imageId, ipAddress, referrer) {
        await this.getPool().query('INSERT INTO image_views (image_id, ip_address, referrer) VALUES ($1, $2, $3)', [imageId, ipAddress || null, referrer || null]);
    }
    async getImageStats(userId) {
        if (userId) {
            return this._queryAll(`SELECT i.id, i.slug, i.original_name, i.created_at,
                COUNT(v.id) AS view_count, MAX(v.viewed_at) AS last_viewed
         FROM images i LEFT JOIN image_views v ON v.image_id = i.id
         WHERE i.user_id = $1 GROUP BY i.id ORDER BY view_count DESC`, [userId]);
        }
        return this._queryAll(`SELECT i.id, i.slug, i.original_name, i.created_at, u.username,
              COUNT(v.id) AS view_count, MAX(v.viewed_at) AS last_viewed
       FROM images i JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id, u.username ORDER BY view_count DESC`);
    }
    async getViewsOverTime(imageId, days = 30, userId = null) {
        const hasImageFilter = Number.isInteger(imageId) && imageId > 0;
        const hasUserFilter = Number.isInteger(userId) && userId > 0;
        if (hasUserFilter) {
            if (hasImageFilter) {
                return this._queryAll(`SELECT DATE(v.viewed_at) AS day, COUNT(*) AS views
           FROM image_views v JOIN images i ON i.id = v.image_id
           WHERE v.viewed_at >= NOW() - INTERVAL '1 day' * $1
             AND v.image_id = $2 AND i.user_id = $3
           GROUP BY day ORDER BY day`, [days, imageId, userId]);
            }
            return this._queryAll(`SELECT DATE(v.viewed_at) AS day, COUNT(*) AS views
         FROM image_views v JOIN images i ON i.id = v.image_id
         WHERE v.viewed_at >= NOW() - INTERVAL '1 day' * $1 AND i.user_id = $2
         GROUP BY day ORDER BY day`, [days, userId]);
        }
        const base = `SELECT DATE(viewed_at) AS day, COUNT(*) AS views
      FROM image_views WHERE viewed_at >= NOW() - INTERVAL '1 day' * $1`;
        if (hasImageFilter) {
            return this._queryAll(base + ' AND image_id = $2 GROUP BY day ORDER BY day', [days, imageId]);
        }
        return this._queryAll(base + ' GROUP BY day ORDER BY day', [days]);
    }
    // ── Data export / import ──────────────────────────────────────────────────
    async exportData() {
        const users = await this._queryAll('SELECT * FROM users ORDER BY id');
        const images = await this._queryAll('SELECT * FROM images ORDER BY id');
        const image_views = await this._queryAll('SELECT * FROM image_views ORDER BY id');
        const image_blobs = await this._queryAll('SELECT * FROM image_blobs ORDER BY image_id');
        const api_tokens = await this._queryAll('SELECT * FROM api_tokens ORDER BY id');
        return { users, images, image_views, image_blobs, api_tokens };
    }
    async importData(data) {
        const client = await this.getPool().connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM api_tokens');
            await client.query('DELETE FROM image_views');
            await client.query('DELETE FROM image_blobs');
            await client.query('DELETE FROM images');
            await client.query('DELETE FROM users');
            for (const u of data.users) {
                await client.query(`INSERT INTO users (id, username, email, real_name, password_hash, is_admin, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [u.id, u.username, u.email || null, u.real_name || null, u.password_hash, u.is_admin, u.created_at]);
            }
            if (data.users.length > 0) {
                const maxId = Math.max(...data.users.map(u => u.id));
                await client.query(`SELECT setval('users_id_seq', $1)`, [maxId]);
            }
            for (const img of data.images) {
                await client.query(`INSERT INTO images (id, filename, original_name, slug, mime_type, size, storage_backend, file_hash, comment, tags, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [img.id, img.filename, img.original_name, img.slug, img.mime_type, img.size, img.storage_backend || 'file', img.file_hash || null, img.comment || null, img.tags || null, img.user_id, img.created_at]);
            }
            if (data.images.length > 0) {
                const maxId = Math.max(...data.images.map(i => i.id));
                await client.query(`SELECT setval('images_id_seq', $1)`, [maxId]);
            }
            for (const v of data.image_views) {
                await client.query(`INSERT INTO image_views (id, image_id, viewed_at, ip_address, referrer) VALUES ($1, $2, $3, $4, $5)`, [v.id, v.image_id, v.viewed_at, v.ip_address, v.referrer]);
            }
            if (data.image_views.length > 0) {
                const maxId = Math.max(...data.image_views.map(v => v.id));
                await client.query(`SELECT setval('image_views_id_seq', $1)`, [maxId]);
            }
            for (const b of (data.image_blobs || [])) {
                await client.query(`INSERT INTO image_blobs (image_id, blob_data, blob_size, created_at) VALUES ($1, $2, $3, $4)`, [b.image_id, b.blob_data, b.blob_size, b.created_at]);
            }
            for (const t of (data.api_tokens || [])) {
                await client.query(`INSERT INTO api_tokens (id, user_id, token_hash, label, expires_at, last_used_at, revoked_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [t.id, t.user_id, t.token_hash, t.label || null, t.expires_at, t.last_used_at || null, t.revoked_at || null, t.created_at]);
            }
            if ((data.api_tokens || []).length > 0) {
                const maxId = Math.max(...data.api_tokens.map((t) => t.id));
                await client.query(`SELECT setval('api_tokens_id_seq', $1)`, [maxId]);
            }
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    // ── Content Flagging helpers ──────────────────────────────────────────────
    async createContentFlag({ imageId, flagType, reason, reporterName = null, reporterEmail = null, reporterCountry = null }) {
        const result = await this._queryOne(`INSERT INTO content_flags (image_id, flag_type, reason, reporter_name, reporter_email, reporter_country)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [imageId, flagType, reason, reporterName, reporterEmail, reporterCountry]);
        return result.id;
    }
    async getContentFlag(flagId) {
        return this._queryOne(`SELECT f.*, i.slug, i.original_name, u.username
       FROM content_flags f JOIN images i ON i.id = f.image_id JOIN users u ON u.id = i.user_id
       WHERE f.id = $1`, [flagId]);
    }
    async listContentFlags({ status = null, imageId = null, limit = 50, offset = 0 } = {}) {
        let query = `SELECT f.id, f.image_id, f.flag_type, f.reason, f.reporter_name, f.reporter_country,
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
        return this._queryAll('SELECT status, COUNT(*)::int as count FROM content_flags GROUP BY status');
    }
    async updateFlagStatus(flagId, newStatus) {
        const result = await this.getPool().query('UPDATE content_flags SET status = $1 WHERE id = $2', [newStatus, flagId]);
        return { changes: result.rowCount ?? 0 };
    }
    async createFlagResolution({ flagId, adminId = null, action, notes = null, evidenceUrl = null }) {
        const result = await this._queryOne(`INSERT INTO flag_resolutions (flag_id, admin_id, action, notes, evidence_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [flagId, adminId, action, notes, evidenceUrl]);
        return result.id;
    }
    async getFlagResolutions(flagId) {
        return this._queryAll(`SELECT r.*, u.username as admin_username
       FROM flag_resolutions r LEFT JOIN users u ON u.id = r.admin_id
       WHERE r.flag_id = $1 ORDER BY r.resolved_at DESC`, [flagId]);
    }
    async getFlagWithResolutions(flagId) {
        const flag = await this.getContentFlag(flagId);
        if (!flag)
            return null;
        const resolutions = await this.getFlagResolutions(flagId);
        return { ...flag, resolutions };
    }
    // ── Thumbnail helpers ─────────────────────────────────────────────────────
    async upsertImageThumbnail(imageId, thumbData, width, height) {
        await this.getPool().query(`INSERT INTO image_thumbnails (image_id, thumb_data, thumb_size, width, height) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (image_id) DO UPDATE SET thumb_data = EXCLUDED.thumb_data, thumb_size = EXCLUDED.thumb_size, width = EXCLUDED.width, height = EXCLUDED.height`, [imageId, thumbData, thumbData.length, width, height]);
    }
    async getImageThumbnail(imageId) {
        return this._queryOne('SELECT image_id, thumb_data, thumb_size, width, height FROM image_thumbnails WHERE image_id = $1', [imageId]);
    }
    // ── Album helpers ─────────────────────────────────────────────────────────
    async createAlbum({ name, description = null, userId }) {
        const row = await this._queryOne('INSERT INTO albums (name, description, user_id) VALUES ($1, $2, $3) RETURNING id', [name, description, userId]);
        return row.id;
    }
    async getAlbumById(id) {
        return this._queryOne('SELECT * FROM albums WHERE id = $1', [id]);
    }
    async listAlbumsByUser(userId) {
        return this._queryAll(`SELECT a.*, COUNT(ai.image_id)::int AS image_count
       FROM albums a LEFT JOIN album_images ai ON ai.album_id = a.id
       WHERE a.user_id = $1 GROUP BY a.id ORDER BY a.created_at DESC`, [userId]);
    }
    async updateAlbum(id, { name, description }) {
        const result = await this.getPool().query('UPDATE albums SET name = $1, description = $2 WHERE id = $3', [name, description || null, id]);
        return { changes: result.rowCount ?? 0 };
    }
    async deleteAlbum(id) {
        const result = await this.getPool().query('DELETE FROM albums WHERE id = $1', [id]);
        return { changes: result.rowCount ?? 0 };
    }
    async addImagesToAlbum(albumId, imageIds) {
        const client = await this.getPool().connect();
        try {
            await client.query('BEGIN');
            for (let i = 0; i < imageIds.length; i++) {
                await client.query(`INSERT INTO album_images (album_id, image_id, sort_order) VALUES ($1, $2, $3)
           ON CONFLICT (album_id, image_id) DO NOTHING`, [albumId, imageIds[i], i]);
            }
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async removeImageFromAlbum(albumId, imageId) {
        const result = await this.getPool().query('DELETE FROM album_images WHERE album_id = $1 AND image_id = $2', [albumId, imageId]);
        return { changes: result.rowCount ?? 0 };
    }
    async getAlbumImages(albumId) {
        return this._queryAll(`SELECT i.*, ai.sort_order, COUNT(v.id)::int AS view_count
       FROM album_images ai JOIN images i ON i.id = ai.image_id
       LEFT JOIN image_views v ON v.image_id = i.id
       WHERE ai.album_id = $1 GROUP BY i.id, ai.sort_order ORDER BY ai.sort_order`, [albumId]);
    }
    // ── Visibility helpers ────────────────────────────────────────────────────
    async updateImageVisibility(imageId, visibility) {
        const result = await this.getPool().query('UPDATE images SET visibility = $1 WHERE id = $2', [visibility, imageId]);
        return { changes: result.rowCount ?? 0 };
    }
    // ── Expiration helpers ────────────────────────────────────────────────────
    async getExpiredImages() {
        return this._queryAll(`SELECT * FROM images WHERE expires_at IS NOT NULL AND expires_at <= NOW()`);
    }
    async updateImageExpiration(imageId, expiresAt) {
        const result = await this.getPool().query('UPDATE images SET expires_at = $1 WHERE id = $2', [expiresAt, imageId]);
        return { changes: result.rowCount ?? 0 };
    }
    // ── Quota helpers ─────────────────────────────────────────────────────────
    async getUserStorageUsed(userId) {
        const row = await this._queryOne('SELECT COALESCE(SUM(size), 0)::bigint AS used FROM images WHERE user_id = $1', [userId]);
        return Number(row.used);
    }
    async getUserStorageQuota(userId) {
        const row = await this._queryOne('SELECT storage_quota_bytes FROM users WHERE id = $1', [userId]);
        return row ? Number(row.storage_quota_bytes) : 0;
    }
    async setUserStorageQuota(userId, quotaBytes) {
        const result = await this.getPool().query('UPDATE users SET storage_quota_bytes = $1 WHERE id = $2', [quotaBytes, userId]);
        return { changes: result.rowCount ?? 0 };
    }
    // ── TOTP helpers ──────────────────────────────────────────────────────────
    async saveTotpSecret(userId, secret) {
        await this.getPool().query(`INSERT INTO totp_secrets (user_id, secret, enabled) VALUES ($1, $2, 0)
       ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, enabled = 0`, [userId, secret]);
    }
    async enableTotp(userId) {
        const result = await this.getPool().query('UPDATE totp_secrets SET enabled = 1 WHERE user_id = $1', [userId]);
        return { changes: result.rowCount ?? 0 };
    }
    async disableTotp(userId) {
        const result = await this.getPool().query('DELETE FROM totp_secrets WHERE user_id = $1', [userId]);
        return { changes: result.rowCount ?? 0 };
    }
    async getTotpSecret(userId) {
        return this._queryOne('SELECT * FROM totp_secrets WHERE user_id = $1', [userId]);
    }
    async isTotpEnabled(userId) {
        const row = await this._queryOne('SELECT enabled FROM totp_secrets WHERE user_id = $1', [userId]);
        return row ? row.enabled === 1 : false;
    }
}
export default PostgresAdapter;
//# sourceMappingURL=postgresql.js.map