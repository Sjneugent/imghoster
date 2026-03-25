'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getImageBySlug, recordView } = require('../db');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

// GET /i/:slug  – serve an image publicly and record a view
router.get('/:slug', (req, res) => {
  const image = getImageBySlug(req.params.slug);
  if (!image) {
    return res.status(404).send('Image not found.');
  }

  const filePath = path.join(UPLOADS_DIR, image.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Image file not found.');
  }

  // Record the view (fire-and-forget; don't count self-referrer from the panel)
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const referrer = req.get('referer') || req.get('referrer') || null;
  try { recordView(image.id, ip, referrer); } catch (_) {}

  // Cache-friendly headers
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', image.mime_type);
  res.sendFile(filePath, { root: '/' });
});

module.exports = router;
