'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getImageBySlug, recordView } = require('../db');
const logger = require('../logger');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// GET /i/:slug  – serve an image publicly and record a view
router.get('/:slug', (req, res) => {
  try {
    const image = getImageBySlug(req.params.slug);
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
    try { recordView(image.id, ip, referrer); } catch (viewErr) {
      logger.warn('Failed to record view', { slug: req.params.slug, error: viewErr.message });
    }

    // Cache-friendly headers
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', image.mime_type);

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

module.exports = router;
