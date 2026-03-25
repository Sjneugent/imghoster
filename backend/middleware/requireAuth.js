'use strict';

function isLocalhost(req) {
  const ip = req.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function requireAuth(req, res, next) {
  if (isLocalhost(req)) return next();
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    return res.redirect('/login.html');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (isLocalhost(req)) return next();
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, isLocalhost };
