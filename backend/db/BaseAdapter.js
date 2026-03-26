'use strict';

/**
 * BaseAdapter – abstract base class defining the database interface contract.
 *
 * All adapters (SQLite, PostgreSQL, etc.) must extend this class and implement
 * every method. All methods are async to support both synchronous and
 * asynchronous database drivers uniformly.
 */
class BaseAdapter {
  /**
   * Initialise the database connection and ensure the schema exists.
   * @param {string|object} config – adapter-specific configuration
   *   SQLite: a file path string
   *   PostgreSQL: a connection config object or DATABASE_URL string
   */
  async init(config) { throw new Error('Not implemented: init'); }

  /** Gracefully close the database connection / pool. */
  async close() { throw new Error('Not implemented: close'); }

  // ── User helpers ──────────────────────────────────────────────────────────

  /**
   * Create a user with a hashed password.
   * @returns {number} the new user's ID
   */
  async createUser(username, plainPassword, isAdmin = false, profile = {}) {
    throw new Error('Not implemented: createUser');
  }

  /** @returns {object|undefined} full user row including password_hash */
  async getUserByUsername(username) {
    throw new Error('Not implemented: getUserByUsername');
  }

  /** @returns {object|undefined} full user row including password_hash */
  async getUserByEmail(email) {
    throw new Error('Not implemented: getUserByEmail');
  }

  /** @returns {object|undefined} user row (id, username, is_admin, created_at) */
  async getUserById(id) {
    throw new Error('Not implemented: getUserById');
  }

  /** @returns {Array} list of user rows (id, username, is_admin, created_at) */
  async listUsers() {
    throw new Error('Not implemented: listUsers');
  }

  async deleteUser(id) {
    throw new Error('Not implemented: deleteUser');
  }

  async updateUserPassword(id, plainPassword) {
    throw new Error('Not implemented: updateUserPassword');
  }

  /**
   * Compare a plain-text password against a bcrypt hash.
   * @returns {boolean}
   */
  async verifyPassword(plainPassword, hash) {
    throw new Error('Not implemented: verifyPassword');
  }

  // ── API token helpers ─────────────────────────────────────────────────────

  async createApiToken({ userId, tokenHash, label, expiresAt }) {
    throw new Error('Not implemented: createApiToken');
  }

  async getActiveApiTokenByHash(tokenHash) {
    throw new Error('Not implemented: getActiveApiTokenByHash');
  }

  async listApiTokensByUser(userId) {
    throw new Error('Not implemented: listApiTokensByUser');
  }

  async revokeApiToken(userId, tokenId) {
    throw new Error('Not implemented: revokeApiToken');
  }

  async touchApiTokenUsage(tokenId) {
    throw new Error('Not implemented: touchApiTokenUsage');
  }

  // ── Image helpers ─────────────────────────────────────────────────────────

  /**
   * @param {object} data – { filename, originalName, slug, mimeType, size, userId, comment, tags }
   * @returns {number} the new image's ID
   */
  async createImage(data) {
    throw new Error('Not implemented: createImage');
  }

  /** @returns {object|undefined} */
  async getImageBySlug(slug) {
    throw new Error('Not implemented: getImageBySlug');
  }

  /** @returns {object|undefined} */
  async getImageById(id) {
    throw new Error('Not implemented: getImageById');
  }

  /** @returns {Array} images with view_count, ordered by created_at DESC */
  async listImagesByUser(userId) {
    throw new Error('Not implemented: listImagesByUser');
  }

  /** @returns {Array} all images with username and view_count */
  async listAllImages() {
    throw new Error('Not implemented: listAllImages');
  }

  async deleteImage(id) {
    throw new Error('Not implemented: deleteImage');
  }

  /** @returns {boolean} */
  async slugExists(slug) {
    throw new Error('Not implemented: slugExists');
  }

  /** @returns {Array} matching images */
  async searchImages(query, userId, isAdmin) {
    throw new Error('Not implemented: searchImages');
  }

  /** @returns {Array} images matching the given IDs */
  async getImagesByIds(ids) {
    throw new Error('Not implemented: getImagesByIds');
  }

  // ── View / stats helpers ──────────────────────────────────────────────────

  async recordView(imageId, ipAddress, referrer) {
    throw new Error('Not implemented: recordView');
  }

  /** @returns {Array} image stats rows */
  async getImageStats(userId) {
    throw new Error('Not implemented: getImageStats');
  }

  /** @returns {Array} { day, views } rows */
  async getViewsOverTime(imageId, days = 30, userId = null) {
    throw new Error('Not implemented: getViewsOverTime');
  }

  // ── Data export / import (for cross-DB migration) ─────────────────────────

  /**
   * Export all data as a plain JS object suitable for JSON serialisation.
   * @returns {{ users: Array, images: Array, image_views: Array, api_tokens?: Array }}
   */
  async exportData() {
    throw new Error('Not implemented: exportData');
  }

  /**
   * Import data previously exported by exportData().
   * Clears existing data first.
   * @param {{ users: Array, images: Array, image_views: Array, api_tokens?: Array }} data
   */
  async importData(data) {
    throw new Error('Not implemented: importData');
  }
}

module.exports = BaseAdapter;
