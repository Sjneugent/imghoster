'use strict';

const crypto = require('crypto');
const { getActiveApiTokenByHash, touchApiTokenUsage } = require('../db');
const { isLocalhost } = require('./requireAuth');

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  const xApiToken = req.headers['x-api-token'];
  if (xApiToken && String(xApiToken).trim()) {
    return String(xApiToken).trim();
  }

  return null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function apiTokenMiddleware(req, _res, next) {
  req.apiTokenAuthenticated = false;

  const token = extractToken(req);
  if (!token) return next();

  const record = await getActiveApiTokenByHash(hashToken(token));
  if (!record) return next();

  req.apiTokenAuthenticated = true;
  req.apiTokenId = record.id;

  if (req.session) {
    req.session.userId = record.user_id;
    req.session.username = record.username;
    req.session.isAdmin = record.is_admin === 1 || record.is_admin === true;
  }

  touchApiTokenUsage(record.id).catch(() => {});
  return next();
}

function requireApiToken(req, res, next) {
  if (isLocalhost(req)) return next();
  if (req.apiTokenAuthenticated) return next();
  return res.status(401).json({ error: 'Valid API token required.' });
}

module.exports = {
  apiTokenMiddleware,
  requireApiToken,
  extractToken,
  hashToken,
};
