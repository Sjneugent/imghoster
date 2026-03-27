import express from 'express';
const router = express.Router();
import {
  createAlbum,
  getAlbumById,
  listAlbumsByUser,
  updateAlbum,
  deleteAlbum,
  addImagesToAlbum,
  removeImageFromAlbum,
  getAlbumImages,
} from '../db/index.js';
import { requireAuth, isLocalhost } from '../middleware/requireAuth.js';
import logger from '../logger.js';

function sanitizeName(raw) {
  return String(raw || '').trim().slice(0, 200);
}

function sanitizeDescription(raw) {
  return String(raw || '').trim().slice(0, 2000) || null;
}

// ── Create album ──────────────────────────────────────────────────────────────
// POST /api/albums   body: { name, description? }
router.post('/', requireAuth, async (req, res) => {
  try {
    const name = sanitizeName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Album name is required.' });

    const userId = req.session.userId || null;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    const description = sanitizeDescription(req.body.description);
    const id = await createAlbum({ name, description, userId });
    res.status(201).json({ id, name, description });
  } catch (err) {
    logger.error('Failed to create album', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create album.' });
  }
});

// ── List albums ───────────────────────────────────────────────────────────────
// GET /api/albums
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId || null;
    if (!userId && !isLocalhost(req)) return res.status(401).json({ error: 'Authentication required.' });
    const albums = await listAlbumsByUser(userId);
    res.json(albums);
  } catch (err) {
    logger.error('Failed to list albums', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to list albums.' });
  }
});

// ── Get album with images ─────────────────────────────────────────────────────
// GET /api/albums/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const album = await getAlbumById(Number(req.params.id));
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    if (!isLocalhost(req) && !req.session.isAdmin && album.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const images = await getAlbumImages(album.id);
    res.json({ ...album, images });
  } catch (err) {
    logger.error('Failed to get album', { id: req.params.id, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to get album.' });
  }
});

// ── Update album ──────────────────────────────────────────────────────────────
// PATCH /api/albums/:id   body: { name?, description? }
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const album = await getAlbumById(Number(req.params.id));
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    if (!isLocalhost(req) && !req.session.isAdmin && album.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const data = {};
    if (req.body.name !== undefined) data.name = sanitizeName(req.body.name);
    if (req.body.description !== undefined) data.description = sanitizeDescription(req.body.description);
    await updateAlbum(album.id, data);
    res.json({ id: album.id, ...data });
  } catch (err) {
    logger.error('Failed to update album', { id: req.params.id, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to update album.' });
  }
});

// ── Delete album ──────────────────────────────────────────────────────────────
// DELETE /api/albums/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const album = await getAlbumById(Number(req.params.id));
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    if (!isLocalhost(req) && !req.session.isAdmin && album.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await deleteAlbum(album.id);
    res.json({ message: 'Album deleted.' });
  } catch (err) {
    logger.error('Failed to delete album', { id: req.params.id, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to delete album.' });
  }
});

// ── Add images to album ──────────────────────────────────────────────────────
// POST /api/albums/:id/images   body: { imageIds: [1, 2, 3] }
router.post('/:id/images', requireAuth, async (req, res) => {
  try {
    const album = await getAlbumById(Number(req.params.id));
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    if (!isLocalhost(req) && !req.session.isAdmin && album.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const imageIds = req.body.imageIds;
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ error: 'Provide an array of image IDs.' });
    }

    const safeIds = imageIds.map(Number).filter(id => Number.isInteger(id) && id > 0);
    await addImagesToAlbum(album.id, safeIds);
    res.json({ message: `Added ${safeIds.length} image(s) to album.` });
  } catch (err) {
    logger.error('Failed to add images to album', { id: req.params.id, error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to add images to album.' });
  }
});

// ── Remove image from album ──────────────────────────────────────────────────
// DELETE /api/albums/:id/images/:imageId
router.delete('/:id/images/:imageId', requireAuth, async (req, res) => {
  try {
    const album = await getAlbumById(Number(req.params.id));
    if (!album) return res.status(404).json({ error: 'Album not found.' });

    if (!isLocalhost(req) && !req.session.isAdmin && album.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await removeImageFromAlbum(album.id, Number(req.params.imageId));
    res.json({ message: 'Image removed from album.' });
  } catch (err) {
    logger.error('Failed to remove image from album', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to remove image from album.' });
  }
});

export default router;
