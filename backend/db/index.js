'use strict';

/**
 * Database abstraction layer.
 *
 * Selects the adapter based on the DB_TYPE environment variable:
 *   DB_TYPE=sqlite      (default) – uses better-sqlite3
 *   DB_TYPE=postgresql   – uses pg (must be installed separately)
 *
 * All exported functions are async and delegate to the active adapter.
 * The interface is identical regardless of which adapter is in use, so the
 * rest of the application is completely database-agnostic.
 */

let adapter = null;

function getAdapter() {
  if (!adapter) throw new Error('Database not initialized. Call initDB() first.');
  return adapter;
}

/**
 * Initialise the database.
 *
 * @param {string|object} config
 *   For SQLite: a file path string (e.g. './data/imghoster.db')
 *   For PostgreSQL: a connection string or pg Pool options object
 * @returns {Promise<object>} the adapter instance
 */
async function initDB(config) {
  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();

  switch (dbType) {
    case 'sqlite': {
      const SqliteAdapter = require('./adapters/sqlite');
      adapter = new SqliteAdapter();
      break;
    }
    case 'postgresql':
    case 'postgres':
    case 'pg': {
      const PostgresAdapter = require('./adapters/postgresql');
      adapter = new PostgresAdapter();
      break;
    }
    default:
      throw new Error(
        `Unsupported DB_TYPE: "${dbType}". ` +
        'Supported values: sqlite, postgresql'
      );
  }

  await adapter.init(config);
  return adapter;
}

/** Return the raw adapter (useful for management scripts). */
function getDB() {
  return getAdapter();
}

// ── Proxy functions ─────────────────────────────────────────────────────────
// Each function delegates to the active adapter. This keeps the module
// interface identical to the original monolithic db.js, so callers only need
// to add `await` — no import changes.

async function createUser(username, plainPassword, isAdmin, profile) {
  return getAdapter().createUser(username, plainPassword, isAdmin, profile);
}

async function getUserByUsername(username) {
  return getAdapter().getUserByUsername(username);
}

async function getUserByEmail(email) {
  return getAdapter().getUserByEmail(email);
}

async function getUserById(id) {
  return getAdapter().getUserById(id);
}

async function listUsers() {
  return getAdapter().listUsers();
}

async function deleteUser(id) {
  return getAdapter().deleteUser(id);
}

async function updateUserPassword(id, plainPassword) {
  return getAdapter().updateUserPassword(id, plainPassword);
}

async function verifyPassword(plainPassword, hash) {
  return getAdapter().verifyPassword(plainPassword, hash);
}

async function createApiToken(data) {
  return getAdapter().createApiToken(data);
}

async function getActiveApiTokenByHash(tokenHash) {
  return getAdapter().getActiveApiTokenByHash(tokenHash);
}

async function listApiTokensByUser(userId) {
  return getAdapter().listApiTokensByUser(userId);
}

async function revokeApiToken(userId, tokenId) {
  return getAdapter().revokeApiToken(userId, tokenId);
}

async function touchApiTokenUsage(tokenId) {
  return getAdapter().touchApiTokenUsage(tokenId);
}

async function createImage(data) {
  return getAdapter().createImage(data);
}

async function getImageBySlug(slug) {
  return getAdapter().getImageBySlug(slug);
}

async function getImageById(id) {
  return getAdapter().getImageById(id);
}

async function listImagesByUser(userId) {
  return getAdapter().listImagesByUser(userId);
}

async function listAllImages() {
  return getAdapter().listAllImages();
}

async function deleteImage(id) {
  return getAdapter().deleteImage(id);
}

async function slugExists(slug) {
  return getAdapter().slugExists(slug);
}

async function searchImages(query, userId, isAdmin) {
  return getAdapter().searchImages(query, userId, isAdmin);
}

async function getImagesByIds(ids) {
  return getAdapter().getImagesByIds(ids);
}

async function recordView(imageId, ipAddress, referrer) {
  return getAdapter().recordView(imageId, ipAddress, referrer);
}

async function getImageStats(userId) {
  return getAdapter().getImageStats(userId);
}

async function getViewsOverTime(imageId, days, userId) {
  return getAdapter().getViewsOverTime(imageId, days, userId);
}

async function exportData() {
  return getAdapter().exportData();
}

async function importData(data) {
  return getAdapter().importData(data);
}

module.exports = {
  initDB,
  getDB,
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  listUsers,
  deleteUser,
  updateUserPassword,
  verifyPassword,
  createApiToken,
  getActiveApiTokenByHash,
  listApiTokensByUser,
  revokeApiToken,
  touchApiTokenUsage,
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
  exportData,
  importData,
};
