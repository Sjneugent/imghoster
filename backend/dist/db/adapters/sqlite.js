import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import path from 'node:path';
import fs from 'node:fs';
import BaseAdapter from '../BaseAdapter.js';
const SALT_ROUNDS = 12;
class SqliteAdapter extends BaseAdapter {
    db;
    constructor() {
        super();
        this.db = null;
    }
    getDb() {
        if (!this.db)
            throw new Error('Database not initialized');
        return this.db;
    }
    async init(config) {
        const dbPath = typeof config === 'string' ? config : config.path;
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
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
        storage_quota_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        storage_backend TEXT NOT NULL DEFAULT 'file',
        file_hash TEXT,
        comment TEXT,
        tags TEXT,
        visibility TEXT NOT NULL DEFAULT 'public',
        expires_at TEXT,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS image_blobs (
        image_id INTEGER PRIMARY KEY,
        blob_data BLOB NOT NULL,
        blob_size INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS image_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL,
        viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
        ip_address TEXT,
        referrer TEXT,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        label TEXT,
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS content_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL,
        flag_type TEXT NOT NULL,
        reason TEXT NOT NULL,
        reporter_name TEXT,
        reporter_email TEXT,
        reporter_country TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS flag_resolutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        flag_id INTEGER NOT NULL,
        admin_id INTEGER,
        action TEXT NOT NULL,
        notes TEXT,
        evidence_url TEXT,
        resolved_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (flag_id) REFERENCES content_flags(id) ON DELETE CASCADE,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
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

      CREATE TABLE IF NOT EXISTS image_thumbnails (
        image_id INTEGER PRIMARY KEY,
        thumb_data BLOB NOT NULL,
        thumb_size INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS album_images (
        album_id INTEGER NOT NULL,
        image_id INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (album_id, image_id),
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS totp_secrets (
        user_id INTEGER PRIMARY KEY,
        secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id);
      CREATE INDEX IF NOT EXISTS idx_album_images_image ON album_images(image_id);
    `);
        // Backward-compatible migrations
        const userCols = this.db.prepare("PRAGMA table_info(users)").all();
        if (!userCols.some(c => c.name === 'email')) {
            this.db.exec('ALTER TABLE users ADD COLUMN email TEXT');
        }
        if (!userCols.some(c => c.name === 'real_name')) {
            this.db.exec('ALTER TABLE users ADD COLUMN real_name TEXT');
        }
        this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(LOWER(email))
      WHERE email IS NOT NULL AND email <> '';
    `);
        const imageCols = this.db.prepare("PRAGMA table_info(images)").all();
        if (!imageCols.some(c => c.name === 'comment')) {
            this.db.exec('ALTER TABLE images ADD COLUMN comment TEXT');
        }
        if (!imageCols.some(c => c.name === 'tags')) {
            this.db.exec('ALTER TABLE images ADD COLUMN tags TEXT');
        }
        if (!imageCols.some(c => c.name === 'file_hash')) {
            this.db.exec('ALTER TABLE images ADD COLUMN file_hash TEXT');
        }
        if (!imageCols.some(c => c.name === 'storage_backend')) {
            this.db.exec("ALTER TABLE images ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'file'");
        }
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_blobs (
        image_id INTEGER PRIMARY KEY,
        blob_data BLOB NOT NULL,
        blob_size INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      )
    `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_images_file_hash ON images(file_hash)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_images_storage_backend ON images(storage_backend)');
        if (!imageCols.some(c => c.name === 'visibility')) {
            this.db.exec("ALTER TABLE images ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
        }
        if (!imageCols.some(c => c.name === 'expires_at')) {
            this.db.exec('ALTER TABLE images ADD COLUMN expires_at TEXT');
        }
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_images_visibility ON images(visibility)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_images_expires ON images(expires_at)');
        if (!userCols.some(c => c.name === 'storage_quota_bytes')) {
            this.db.exec('ALTER TABLE users ADD COLUMN storage_quota_bytes INTEGER NOT NULL DEFAULT 0');
        }
        // Ensure new tables exist for existing DBs
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_thumbnails (
        image_id INTEGER PRIMARY KEY,
        thumb_data BLOB NOT NULL,
        thumb_size INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS album_images (
        album_id INTEGER NOT NULL,
        image_id INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (album_id, image_id),
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS totp_secrets (
        user_id INTEGER PRIMARY KEY,
        secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id);
      CREATE INDEX IF NOT EXISTS idx_album_images_image ON album_images(image_id);
    `);
        return this;
    }
    async close() {
        if (this.db)
            this.db.close();
    }
    getRawDB() {
        return this.getDb();
    }
    // ── User helpers ──────────────────────────────────────────────────────────
    async createUser(username, plainPassword, isAdmin = false, profile = {}) {
        const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
        const email = profile.email ? String(profile.email).trim().toLowerCase() : null;
        const realName = profile.realName ? String(profile.realName).trim() : null;
        const result = this.getDb().prepare('INSERT INTO users (username, email, real_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)').run(username, email, realName, hash, isAdmin ? 1 : 0);
        return Number(result.lastInsertRowid);
    }
    async getUserByUsername(username) {
        return this.getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
    }
    async getUserByEmail(email) {
        return this.getDb().prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    }
    async getUserById(id) {
        return this.getDb().prepare('SELECT id, username, email, real_name, is_admin, created_at FROM users WHERE id = ?').get(id);
    }
    async listUsers() {
        return this.getDb().prepare('SELECT id, username, email, real_name, is_admin, created_at FROM users ORDER BY created_at DESC').all();
    }
    async deleteUser(id) {
        return this.getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
    }
    async updateUserPassword(id, plainPassword) {
        const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
        return this.getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    }
    async verifyPassword(plainPassword, hash) {
        return bcrypt.compare(plainPassword, hash);
    }
    // ── API token helpers ────────────────────────────────────────────────────
    async createApiToken({ userId, tokenHash, label, expiresAt }) {
        const result = this.getDb().prepare(`INSERT INTO api_tokens (user_id, token_hash, label, expires_at) VALUES (?, ?, ?, ?)`).run(userId, tokenHash, label || null, expiresAt);
        return Number(result.lastInsertRowid);
    }
    async getActiveApiTokenByHash(tokenHash) {
        return this.getDb().prepare(`SELECT t.id, t.user_id, t.expires_at, u.username, u.is_admin
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?
         AND t.revoked_at IS NULL
         AND julianday(t.expires_at) > julianday('now')`).get(tokenHash);
    }
    async listApiTokensByUser(userId) {
        return this.getDb().prepare(`SELECT id, label, expires_at, last_used_at, revoked_at, created_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
    }
    async revokeApiToken(userId, tokenId) {
        return this.getDb().prepare(`UPDATE api_tokens SET revoked_at = datetime('now')
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(tokenId, userId);
    }
    async touchApiTokenUsage(tokenId) {
        return this.getDb().prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(tokenId);
    }
    // ── Image helpers ─────────────────────────────────────────────────────────
    async createImage({ filename, originalName, slug, mimeType, size, userId, comment = null, tags = null, fileHash = null, storageBackend = 'file', visibility = 'public', expiresAt = null, }) {
        const result = this.getDb().prepare(`INSERT INTO images (filename, original_name, slug, mime_type, size, storage_backend, file_hash, comment, tags, user_id, visibility, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(filename, originalName, slug, mimeType, size, storageBackend, fileHash, comment, tags, userId, visibility, expiresAt);
        return Number(result.lastInsertRowid);
    }
    async upsertImageBlob(imageId, blobData) {
        this.getDb().prepare(`INSERT INTO image_blobs (image_id, blob_data, blob_size) VALUES (?, ?, ?)
       ON CONFLICT(image_id) DO UPDATE SET blob_data = excluded.blob_data, blob_size = excluded.blob_size`).run(imageId, blobData, blobData.length);
    }
    async getImageBlobByImageId(imageId) {
        return this.getDb().prepare('SELECT image_id, blob_data, blob_size, created_at FROM image_blobs WHERE image_id = ?').get(imageId);
    }
    async getImageBySlug(slug) {
        return this.getDb().prepare('SELECT * FROM images WHERE slug = ?').get(slug);
    }
    async getImageById(id) {
        return this.getDb().prepare('SELECT * FROM images WHERE id = ?').get(id);
    }
    async listImagesByUser(userId) {
        return this.getDb().prepare(`SELECT i.*, COUNT(v.id) AS view_count
       FROM images i LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = ? GROUP BY i.id ORDER BY i.created_at DESC`).all(userId);
    }
    async listAllImages() {
        return this.getDb().prepare(`SELECT i.*, u.username, COUNT(v.id) AS view_count
       FROM images i JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id ORDER BY i.created_at DESC`).all();
    }
    async deleteImage(id) {
        return this.getDb().prepare('DELETE FROM images WHERE id = ?').run(id);
    }
    async slugExists(slug) {
        return !!this.getDb().prepare('SELECT 1 FROM images WHERE slug = ?').get(slug);
    }
    async searchImages(query, userId, isAdmin) {
        const pattern = `%${query}%`;
        if (isAdmin) {
            return this.getDb().prepare(`SELECT i.*, u.username, COUNT(v.id) AS view_count
         FROM images i JOIN users u ON u.id = i.user_id
         LEFT JOIN image_views v ON v.image_id = i.id
         WHERE i.slug LIKE ? OR i.original_name LIKE ? OR u.username LIKE ?
         GROUP BY i.id ORDER BY i.created_at DESC`).all(pattern, pattern, pattern);
        }
        return this.getDb().prepare(`SELECT i.*, COUNT(v.id) AS view_count
       FROM images i LEFT JOIN image_views v ON v.image_id = i.id
       WHERE i.user_id = ? AND (i.slug LIKE ? OR i.original_name LIKE ?)
       GROUP BY i.id ORDER BY i.created_at DESC`).all(userId, pattern, pattern);
    }
    async getImagesByIds(ids) {
        if (!ids.length)
            return [];
        const placeholders = ids.map(() => '?').join(',');
        return this.getDb().prepare(`SELECT * FROM images WHERE id IN (${placeholders})`).all(...ids);
    }
    async checkDuplicateHash(fileHash) {
        if (!fileHash)
            return null;
        return this.getDb().prepare('SELECT id, slug, original_name, user_id, created_at FROM images WHERE file_hash = ? LIMIT 1').get(fileHash);
    }
    async getImagesByFileHash(fileHash) {
        if (!fileHash)
            return [];
        return this.getDb().prepare('SELECT id, slug, original_name, user_id, created_at FROM images WHERE file_hash = ? ORDER BY created_at DESC').all(fileHash);
    }
    // ── View / stats helpers ──────────────────────────────────────────────────
    async recordView(imageId, ipAddress, referrer) {
        this.getDb().prepare('INSERT INTO image_views (image_id, ip_address, referrer) VALUES (?, ?, ?)').run(imageId, ipAddress || null, referrer || null);
    }
    async getImageStats(userId) {
        if (userId) {
            return this.getDb().prepare(`SELECT i.id, i.slug, i.original_name, i.created_at,
                COUNT(v.id) AS view_count, MAX(v.viewed_at) AS last_viewed
         FROM images i LEFT JOIN image_views v ON v.image_id = i.id
         WHERE i.user_id = ? GROUP BY i.id ORDER BY view_count DESC`).all(userId);
        }
        return this.getDb().prepare(`SELECT i.id, i.slug, i.original_name, i.created_at, u.username,
              COUNT(v.id) AS view_count, MAX(v.viewed_at) AS last_viewed
       FROM images i JOIN users u ON u.id = i.user_id
       LEFT JOIN image_views v ON v.image_id = i.id
       GROUP BY i.id ORDER BY view_count DESC`).all();
    }
    async getViewsOverTime(imageId, days = 30, userId = null) {
        const hasImageFilter = Number.isInteger(imageId) && imageId > 0;
        const hasUserFilter = Number.isInteger(userId) && userId > 0;
        if (hasUserFilter) {
            if (hasImageFilter) {
                return this.getDb().prepare(`SELECT date(v.viewed_at) AS day, COUNT(*) AS views
           FROM image_views v JOIN images i ON i.id = v.image_id
           WHERE v.viewed_at >= datetime('now', '-' || ? || ' days')
             AND v.image_id = ? AND i.user_id = ?
           GROUP BY day ORDER BY day`).all(days, imageId, userId);
            }
            return this.getDb().prepare(`SELECT date(v.viewed_at) AS day, COUNT(*) AS views
         FROM image_views v JOIN images i ON i.id = v.image_id
         WHERE v.viewed_at >= datetime('now', '-' || ? || ' days') AND i.user_id = ?
         GROUP BY day ORDER BY day`).all(days, userId);
        }
        const base = `SELECT date(viewed_at) AS day, COUNT(*) AS views
      FROM image_views WHERE viewed_at >= datetime('now', '-' || ? || ' days')`;
        if (hasImageFilter) {
            return this.getDb().prepare(base + ' AND image_id = ? GROUP BY day ORDER BY day').all(days, imageId);
        }
        return this.getDb().prepare(base + ' GROUP BY day ORDER BY day').all(days);
    }
    // ── Data export / import ──────────────────────────────────────────────────
    async exportData() {
        const db = this.getDb();
        return {
            users: db.prepare('SELECT * FROM users').all(),
            images: db.prepare('SELECT * FROM images').all(),
            image_views: db.prepare('SELECT * FROM image_views').all(),
            image_blobs: db.prepare('SELECT * FROM image_blobs').all(),
            api_tokens: db.prepare('SELECT * FROM api_tokens').all(),
        };
    }
    async importData(data) {
        const db = this.getDb();
        const trx = db.transaction(() => {
            db.prepare('DELETE FROM api_tokens').run();
            db.prepare('DELETE FROM image_views').run();
            db.prepare('DELETE FROM image_blobs').run();
            db.prepare('DELETE FROM images').run();
            db.prepare('DELETE FROM users').run();
            const insertUser = db.prepare(`INSERT INTO users (id, username, email, real_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const u of data.users) {
                insertUser.run(u.id, u.username, u.email || null, u.real_name || null, u.password_hash, u.is_admin, u.created_at);
            }
            const insertImage = db.prepare(`INSERT INTO images (id, filename, original_name, slug, mime_type, size, storage_backend, file_hash, comment, tags, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const img of data.images) {
                insertImage.run(img.id, img.filename, img.original_name, img.slug, img.mime_type, img.size, img.storage_backend || 'file', img.file_hash || null, img.comment || null, img.tags || null, img.user_id, img.created_at);
            }
            if (Array.isArray(data.image_blobs)) {
                const insertBlob = db.prepare(`INSERT INTO image_blobs (image_id, blob_data, blob_size, created_at) VALUES (?, ?, ?, ?)`);
                for (const b of data.image_blobs) {
                    insertBlob.run(b.image_id, b.blob_data, b.blob_size, b.created_at);
                }
            }
            const insertView = db.prepare(`INSERT INTO image_views (id, image_id, viewed_at, ip_address, referrer) VALUES (?, ?, ?, ?, ?)`);
            for (const v of data.image_views) {
                insertView.run(v.id, v.image_id, v.viewed_at, v.ip_address, v.referrer);
            }
            const insertToken = db.prepare(`INSERT INTO api_tokens (id, user_id, token_hash, label, expires_at, last_used_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            for (const t of (data.api_tokens || [])) {
                insertToken.run(t.id, t.user_id, t.token_hash, t.label || null, t.expires_at, t.last_used_at || null, t.revoked_at || null, t.created_at);
            }
        });
        trx();
    }
    // ── Content Flagging helpers ──────────────────────────────────────────────
    async createContentFlag({ imageId, flagType, reason, reporterName = null, reporterEmail = null, reporterCountry = null }) {
        const result = this.getDb().prepare(`INSERT INTO content_flags (image_id, flag_type, reason, reporter_name, reporter_email, reporter_country) VALUES (?, ?, ?, ?, ?, ?)`).run(imageId, flagType, reason, reporterName, reporterEmail, reporterCountry);
        return Number(result.lastInsertRowid);
    }
    async getContentFlag(flagId) {
        return this.getDb().prepare(`SELECT f.*, i.slug, i.original_name, u.username
       FROM content_flags f JOIN images i ON i.id = f.image_id JOIN users u ON u.id = i.user_id
       WHERE f.id = ?`).get(flagId);
    }
    async listContentFlags({ status = null, imageId = null, limit = 50, offset = 0 } = {}) {
        let query = `SELECT f.id, f.image_id, f.flag_type, f.reason, f.reporter_name, f.reporter_country,
              f.status, f.created_at, i.slug, i.original_name, u.username,
              COUNT(res.id) as resolution_count
       FROM content_flags f
       JOIN images i ON i.id = f.image_id
       JOIN users u ON u.id = i.user_id
       LEFT JOIN flag_resolutions res ON res.flag_id = f.id
       WHERE 1=1`;
        const params = [];
        if (status) {
            query += ` AND f.status = ?`;
            params.push(status);
        }
        if (imageId) {
            query += ` AND f.image_id = ?`;
            params.push(imageId);
        }
        query += ` GROUP BY f.id ORDER BY f.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        return this.getDb().prepare(query).all(...params);
    }
    async getFlagCountByStatus() {
        return this.getDb().prepare('SELECT status, COUNT(*) as count FROM content_flags GROUP BY status').all();
    }
    async updateFlagStatus(flagId, newStatus) {
        return this.getDb().prepare('UPDATE content_flags SET status = ? WHERE id = ?').run(newStatus, flagId);
    }
    async createFlagResolution({ flagId, adminId = null, action, notes = null, evidenceUrl = null }) {
        const result = this.getDb().prepare(`INSERT INTO flag_resolutions (flag_id, admin_id, action, notes, evidence_url) VALUES (?, ?, ?, ?, ?)`).run(flagId, adminId, action, notes, evidenceUrl);
        return Number(result.lastInsertRowid);
    }
    async getFlagResolutions(flagId) {
        return this.getDb().prepare(`SELECT r.*, u.username as admin_username
       FROM flag_resolutions r LEFT JOIN users u ON u.id = r.admin_id
       WHERE r.flag_id = ? ORDER BY r.resolved_at DESC`).all(flagId);
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
        this.getDb().prepare(`INSERT INTO image_thumbnails (image_id, thumb_data, thumb_size, width, height) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(image_id) DO UPDATE SET thumb_data = excluded.thumb_data, thumb_size = excluded.thumb_size, width = excluded.width, height = excluded.height`).run(imageId, thumbData, thumbData.length, width, height);
    }
    async getImageThumbnail(imageId) {
        return this.getDb().prepare('SELECT image_id, thumb_data, thumb_size, width, height FROM image_thumbnails WHERE image_id = ?').get(imageId);
    }
    // ── Album helpers ─────────────────────────────────────────────────────────
    async createAlbum({ name, description = null, userId }) {
        const result = this.getDb().prepare('INSERT INTO albums (name, description, user_id) VALUES (?, ?, ?)').run(name, description, userId);
        return Number(result.lastInsertRowid);
    }
    async getAlbumById(id) {
        return this.getDb().prepare('SELECT * FROM albums WHERE id = ?').get(id);
    }
    async listAlbumsByUser(userId) {
        return this.getDb().prepare(`SELECT a.*, COUNT(ai.image_id) AS image_count
       FROM albums a LEFT JOIN album_images ai ON ai.album_id = a.id
       WHERE a.user_id = ? GROUP BY a.id ORDER BY a.created_at DESC`).all(userId);
    }
    async updateAlbum(id, { name, description }) {
        return this.getDb().prepare('UPDATE albums SET name = ?, description = ? WHERE id = ?').run(name, description || null, id);
    }
    async deleteAlbum(id) {
        return this.getDb().prepare('DELETE FROM albums WHERE id = ?').run(id);
    }
    async addImagesToAlbum(albumId, imageIds) {
        const db = this.getDb();
        const stmt = db.prepare(`INSERT OR IGNORE INTO album_images (album_id, image_id, sort_order) VALUES (?, ?, ?)`);
        const trx = db.transaction(() => {
            for (let i = 0; i < imageIds.length; i++) {
                stmt.run(albumId, imageIds[i], i);
            }
        });
        trx();
    }
    async removeImageFromAlbum(albumId, imageId) {
        return this.getDb().prepare('DELETE FROM album_images WHERE album_id = ? AND image_id = ?').run(albumId, imageId);
    }
    async getAlbumImages(albumId) {
        return this.getDb().prepare(`SELECT i.*, ai.sort_order, COUNT(v.id) AS view_count
       FROM album_images ai JOIN images i ON i.id = ai.image_id
       LEFT JOIN image_views v ON v.image_id = i.id
       WHERE ai.album_id = ? GROUP BY i.id ORDER BY ai.sort_order`).all(albumId);
    }
    // ── Visibility helpers ────────────────────────────────────────────────────
    async updateImageVisibility(imageId, visibility) {
        return this.getDb().prepare('UPDATE images SET visibility = ? WHERE id = ?').run(visibility, imageId);
    }
    // ── Expiration helpers ────────────────────────────────────────────────────
    async getExpiredImages() {
        return this.getDb().prepare(`SELECT * FROM images WHERE expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')`).all();
    }
    async updateImageExpiration(imageId, expiresAt) {
        return this.getDb().prepare('UPDATE images SET expires_at = ? WHERE id = ?').run(expiresAt, imageId);
    }
    // ── Quota helpers ─────────────────────────────────────────────────────────
    async getUserStorageUsed(userId) {
        const row = this.getDb().prepare('SELECT COALESCE(SUM(size), 0) AS used FROM images WHERE user_id = ?').get(userId);
        return row.used;
    }
    async getUserStorageQuota(userId) {
        const row = this.getDb().prepare('SELECT storage_quota_bytes FROM users WHERE id = ?').get(userId);
        return row ? row.storage_quota_bytes : 0;
    }
    async setUserStorageQuota(userId, quotaBytes) {
        return this.getDb().prepare('UPDATE users SET storage_quota_bytes = ? WHERE id = ?').run(quotaBytes, userId);
    }
    // ── TOTP helpers ──────────────────────────────────────────────────────────
    async saveTotpSecret(userId, secret) {
        this.getDb().prepare(`INSERT INTO totp_secrets (user_id, secret, enabled) VALUES (?, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0`).run(userId, secret);
    }
    async enableTotp(userId) {
        return this.getDb().prepare('UPDATE totp_secrets SET enabled = 1 WHERE user_id = ?').run(userId);
    }
    async disableTotp(userId) {
        return this.getDb().prepare('DELETE FROM totp_secrets WHERE user_id = ?').run(userId);
    }
    async getTotpSecret(userId) {
        return this.getDb().prepare('SELECT * FROM totp_secrets WHERE user_id = ?').get(userId);
    }
    async isTotpEnabled(userId) {
        const row = this.getDb().prepare('SELECT enabled FROM totp_secrets WHERE user_id = ?').get(userId);
        return row ? row.enabled === 1 : false;
    }
}
export default SqliteAdapter;
//# sourceMappingURL=sqlite.js.map