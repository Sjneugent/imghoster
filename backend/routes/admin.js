'use strict';

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/requireAuth');
const { listUsers, createUser, deleteUser, updateUserPassword, getUserById } = require('../db');

// All admin routes require admin privileges
router.use(requireAdmin);

// GET /api/admin/users
router.get('/users', (_req, res) => {
  res.json(listUsers());
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
    res.status(201).json({ id, username });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    throw err;
  }
});

// PATCH /api/admin/users/:id/password
router.patch('/users/:id/password', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const user = getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });

  updateUserPassword(user.id, password);
  res.json({ message: 'Password updated.' });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  const targetId = Number(req.params.id);

  // Prevent admins from deleting themselves
  if (targetId === req.session.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  const user = getUserById(targetId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  deleteUser(targetId);
  res.json({ message: 'User deleted.' });
});

module.exports = router;
