'use strict';

const express = require('express');
const router = express.Router();
const { getUserByUsername, verifyPassword } = require('../db');
const { isLocalhost } = require('../middleware/requireAuth');
const logger = require('../logger');

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      logger.warn('Failed login attempt', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Extend session lifetime when "remember me" is checked
    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    } else {
      req.session.cookie.expires = false; // session cookie
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin === 1;

    logger.info('User logged in', { username: user.username, userId: user.id });

    res.json({
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin === 1,
      csrfToken: req.session.csrfToken,
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const username = req.session ? req.session.username : 'unknown';
  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout failed', { error: err.message });
      return res.status(500).json({ error: 'Could not log out.' });
    }
    res.clearCookie('imghoster.sid');
    logger.info('User logged out', { username });
    res.json({ message: 'Logged out successfully.' });
  });
});

// GET /api/auth/me  – returns current session info + CSRF token
router.get('/me', (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      if (isLocalhost(req)) {
        return res.json({
          id: 0,
          username: 'localhost-admin',
          isAdmin: true,
          csrfToken: req.session ? req.session.csrfToken : null,
        });
      }
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    res.json({
      id: req.session.userId,
      username: req.session.username,
      isAdmin: req.session.isAdmin,
      csrfToken: req.session.csrfToken,
    });
  } catch (err) {
    logger.error('Auth check error', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

module.exports = router;
