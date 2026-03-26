'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const {
  createImage,
  getImageById,
  listImagesByUser,
  listAllImages,
  deleteImage,
  slugExists,
  listUsers,
} = require('../db');
const { requireAuth, isLocalhost } = require('../middleware/requireAuth');
const logger = require('../logger');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

// multer storage – keep original extension, use uuid for filename
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  },
});

// Validate and sanitise a user-supplied slug
function sanitiseSlug(raw) {
  return raw
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

// Return a fallback user ID for unauthenticated localhost requests
function getLocalhostFallbackUserId() {
  const users = listUsers();
  const admin = users.find(u => u.is_admin === 1);
  return admin ? admin.id : (users.length > 0 ? users[0].id : null);
}

// ── Upload ────────────────────────────────────────────────────────────────────
// POST /api/images/upload
router.post('/upload', requireAuth, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    let slug = req.body.slug ? sanitiseSlug(req.body.slug) : '';
    if (!slug) {
      slug = path.basename(req.file.filename, path.extname(req.file.filename));
    }

    if (slugExists(slug)) {
      // Remove uploaded file and reject
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({ error: `The URL slug "${slug}" is already taken.` });
    }

    const userId = req.session.userId || (isLocalhost(req) ? getLocalhostFallbackUserId() : null);
    if (!userId) {
      fs.unlink(req.file.path, () => {});
      logger.warn('Upload rejected: no user available', { ip: req.ip });
      return res.status(500).json({ error: 'No user available to associate upload with.' });
    }

    const id = createImage({
      filename: req.file.filename,
      originalName: req.file.originalname,
      slug,
      mimeType: req.file.mimetype,
      size: req.file.size,
      userId,
    });

    const host = req.get('host') || 'localhost';
    const protocol = req.secure ? 'https' : 'http';

    logger.info('Image uploaded', { id, slug, userId, filename: req.file.filename });

    res.status(201).json({
      id,
      slug,
      url: `${protocol}://${host}/i/${slug}`,
    });
  } catch (err) {
    logger.error('Upload failed', { error: err.message, stack: err.stack });
    // Clean up uploaded file on unexpected error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Upload failed due to an internal error.' });
    }
  }
});

// ── List ──────────────────────────────────────────────────────────────────────
// GET /api/images          – own images
// GET /api/images?all=1    – all images (admin only)
router.get('/', requireAuth, (req, res) => {
  try {
    if (isLocalhost(req) && !req.session.userId) {
      return res.json(listAllImages());
    }
    if (req.query.all === '1' && (req.session.isAdmin || isLocalhost(req))) {
      return res.json(listAllImages());
    }
    res.json(listImagesByUser(req.session.userId));
  } catch (err) {
    logger.error('Failed to list images', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to retrieve images.' });
    }
  }
});

// ── Single image metadata ─────────────────────────────────────────────────────
// GET /api/images/:id
router.get('/:id', requireAuth, (req, res) => {
  try {
    const image = getImageById(Number(req.params.id));
    if (!image) return res.status(404).json({ error: 'Image not found.' });

    // Non-admins can only see their own images; localhost gets full access
    if (!isLocalhost(req) && !req.session.isAdmin && image.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    res.json(image);
  } catch (err) {
    logger.error('Failed to get image metadata', { id: req.params.id, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to retrieve image.' });
    }
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
// DELETE /api/images/:id
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const image = getImageById(Number(req.params.id));
    if (!image) return res.status(404).json({ error: 'Image not found.' });

    if (!isLocalhost(req) && !req.session.isAdmin && image.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    // Delete file from disk
    const filePath = path.join(UPLOADS_DIR, image.filename);
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr && unlinkErr.code !== 'ENOENT') {
        logger.warn('Failed to delete image file from disk', { filename: image.filename, error: unlinkErr.message });
      }
    });

    deleteImage(image.id);
    logger.info('Image deleted', { id: image.id, slug: image.slug });
    res.json({ message: 'Image deleted.' });
  } catch (err) {
    logger.error('Failed to delete image', { id: req.params.id, error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to delete image.' });
    }
  }
});

// Multer error handler
router.use((err, _req, res, _next) => {
  logger.warn('Upload error', { error: err.message });
  res.status(400).json({ error: err.message || 'Upload error.' });
});

module.exports = router;
