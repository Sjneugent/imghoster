'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const {
  createImage,
  getImageById,
  listImagesByUser,
  listAllImages,
  deleteImage,
  slugExists,
  searchImages,
  getImagesByIds,
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
async function getLocalhostFallbackUserId() {
  const users = await listUsers();
  const admin = users.find(u => u.is_admin === 1);
  return admin ? admin.id : (users.length > 0 ? users[0].id : null);
}

// ── Upload ────────────────────────────────────────────────────────────────────
// POST /api/images/upload
router.post('/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    let slug = req.body.slug ? sanitiseSlug(req.body.slug) : '';
    if (!slug) {
      slug = path.basename(req.file.filename, path.extname(req.file.filename));
    }

    if (await slugExists(slug)) {
      // Remove uploaded file and reject
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({ error: `The URL slug "${slug}" is already taken.` });
    }

    const userId = req.session.userId || (isLocalhost(req) ? await getLocalhostFallbackUserId() : null);
    if (!userId) {
      fs.unlink(req.file.path, () => {});
      logger.warn('Upload rejected: no user available', { ip: req.ip });
      return res.status(500).json({ error: 'No user available to associate upload with.' });
    }

    const id = await createImage({
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
// GET /api/images?q=term   – search images
router.get('/', requireAuth, async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const showAll = req.query.all === '1';

    if (query) {
      const isAdmin = showAll && (req.session.isAdmin || isLocalhost(req));
      const userId = isAdmin ? null : (req.session.userId || null);
      if (isLocalhost(req) && !req.session.userId) {
        return res.json(await searchImages(query, null, true));
      }
      return res.json(await searchImages(query, userId, isAdmin));
    }

    if (isLocalhost(req) && !req.session.userId) {
      return res.json(await listAllImages());
    }
    if (showAll && (req.session.isAdmin || isLocalhost(req))) {
      return res.json(await listAllImages());
    }
    res.json(await listImagesByUser(req.session.userId));
  } catch (err) {
    logger.error('Failed to list images', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to retrieve images.' });
    }
  }
});

// ── Bulk download as zip ──────────────────────────────────────────────────────
// POST /api/images/download   body: { ids: [1, 2, 3] }
router.post('/download', requireAuth, async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Provide an array of image IDs.' });
    }

    if (ids.length > 500) {
      return res.status(400).json({ error: 'Too many images. Maximum 500 per download.' });
    }

    // Sanitise: only accept positive integers
    const safeIds = [...new Set(
      ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0)
    )];

    if (safeIds.length === 0) {
      return res.status(400).json({ error: 'No valid image IDs provided.' });
    }

    const images = await getImagesByIds(safeIds);
    if (images.length === 0) {
      return res.status(404).json({ error: 'No images found.' });
    }

    // Authorization: non-admin users can only download their own images
    if (!isLocalhost(req) && !req.session.isAdmin) {
      const unauthorized = images.find(img => img.user_id !== req.session.userId);
      if (unauthorized) {
        return res.status(403).json({ error: 'Forbidden: you can only download your own images.' });
      }
    }

    // Verify all files exist on disk before streaming
    const missing = images.filter(img => !fs.existsSync(path.join(UPLOADS_DIR, img.filename)));
    if (missing.length > 0) {
      logger.warn('Download requested for missing files', { missing: missing.map(m => m.filename) });
    }

    const available = images.filter(img => fs.existsSync(path.join(UPLOADS_DIR, img.filename)));
    if (available.length === 0) {
      return res.status(404).json({ error: 'No image files available on disk.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="images.zip"');

    const archive = archiver('zip', { zlib: { level: 5 } });

    archive.on('error', (err) => {
      logger.error('Archive error', { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create zip archive.' });
      }
    });

    archive.pipe(res);

    // Use slug + original extension as the filename inside the zip
    const usedNames = new Set();
    for (const img of available) {
      const ext = path.extname(img.filename);
      let name = img.slug + ext;
      // Deduplicate in case of collisions
      if (usedNames.has(name)) {
        name = `${img.slug}_${img.id}${ext}`;
      }
      usedNames.add(name);
      archive.file(path.join(UPLOADS_DIR, img.filename), { name });
    }

    archive.finalize();

    logger.info('Bulk download', { count: available.length, ids: safeIds });
  } catch (err) {
    logger.error('Download failed', { error: err.message, stack: err.stack });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed.' });
    }
  }
});

// ── Single image metadata ─────────────────────────────────────────────────────
// GET /api/images/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const image = await getImageById(Number(req.params.id));
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
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const image = await getImageById(Number(req.params.id));
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

    await deleteImage(image.id);
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
