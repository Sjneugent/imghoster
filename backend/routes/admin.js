'use strict';

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/requireAuth');
const { listUsers, createUser, deleteUser, updateUserPassword, getUserById } = require('../db');
const logger = require('../logger');

// All admin routes require admin privileges
router.use(requireAdmin);

// GET /api/admin/users
router.get('/users', (_req, res) => {
  try {
    res.json(listUsers());
  } catch (err) {
    logger.error('Failed to list users', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to retrieve users.' });
    }
  }
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const { username, password, isAdmin } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const id = createUser(username, password, !!isAdmin);
    logger.info('User created', { id, username, isAdmin: !!isAdmin });
    res.status(201).json({ id, username });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    logger.error('Failed to create user', { username, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create user.' });
    }
  }
});

// PATCH /api/admin/users/:id/password
router.patch('/users/:id/password', (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const user = getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found.' });

    updateUserPassword(user.id, password);
    logger.info('User password updated', { userId: user.id, username: user.username });
    res.json({ message: 'Password updated.' });
  } catch (err) {
    logger.error('Failed to update password', { id: req.params.id, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to update password.' });
    }
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  try {
    const targetId = Number(req.params.id);

    // Prevent admins from deleting themselves
    if (targetId === req.session.userId) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const user = getUserById(targetId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    deleteUser(targetId);
    logger.info('User deleted', { userId: targetId, username: user.username });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    logger.error('Failed to delete user', { id: req.params.id, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to delete user.' });
    }
  }
});

module.exports = router;
