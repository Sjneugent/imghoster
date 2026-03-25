'use strict';

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    return res.redirect('/login.html');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
