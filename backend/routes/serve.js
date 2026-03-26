import express from 'express';
const router = express.Router();
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getImageBySlug, recordView } from '../db/index.js';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// GET /i/:slug  – serve an image publicly and record a view
router.get('/:slug', async (req, res) => {
  try {
    const image = await getImageBySlug(req.params.slug);
    if (!image) {
      logger.warn('Image not found for slug', { slug: req.params.slug });
      return res.status(404).send('Image not found.');
    }

    const filePath = path.join(UPLOADS_DIR, image.filename);
    if (!fs.existsSync(filePath)) {
      logger.warn('Image file missing from disk', { slug: req.params.slug, filename: image.filename });
      return res.status(404).send('Image file not found.');
    }

    // Record the view (fire-and-forget; don't count self-referrer from the panel)
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const referrer = req.get('referer') || req.get('referrer') || null;
    try { await recordView(image.id, ip, referrer); } catch (viewErr) {
      logger.warn('Failed to record view', { slug: req.params.slug, error: viewErr.message });
    }

    // Cache-friendly headers
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const isSvg = image.mime_type === 'image/svg+xml' || path.extname(image.filename).toLowerCase() === '.svg';
    if (isSvg) {
      // Never render user-uploaded SVG inline to avoid active content execution.
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="image.svg"');
    } else {
      res.setHeader('Content-Type', image.mime_type);
    }

    // Serve file using the filename relative to the uploads root directory.
    // Using { root: UPLOADS_DIR } ensures safe path resolution and avoids
    // ForbiddenError that occurred with absolute paths.
    res.sendFile(image.filename, { root: UPLOADS_DIR }, (err) => {
      if (err) {
        logger.error('sendFile failed', { slug: req.params.slug, error: err.message });
        if (!res.headersSent) {
          res.status(err.status || 500).send('Error serving image.');
        }
      } else {
        logger.debug('Image served', { slug: req.params.slug, ip });
      }
    });
  } catch (err) {
    logger.error('Unexpected error serving image', { slug: req.params.slug, error: err.message });
    if (!res.headersSent) {
      res.status(500).send('Internal server error.');
    }
  }
});

export default router;
