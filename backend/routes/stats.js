'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getImageStats, getViewsOverTime } = require('../db');
const logger = require('../logger');

// GET /api/stats              – stats for current user's images
// GET /api/stats?all=1        – all images (admin)
router.get('/', requireAuth, (req, res) => {
  try {
    const userId = (req.query.all === '1' && req.session.isAdmin)
      ? null
      : req.session.userId;
    res.json(getImageStats(userId));
  } catch (err) {
    logger.error('Failed to get image stats', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to retrieve stats.' });
    }
  }
});

// GET /api/stats/timeline?days=30           – overall views over time
// GET /api/stats/timeline?imageId=5&days=30 – views for a specific image
router.get('/timeline', requireAuth, (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const imageId = req.query.imageId ? Number(req.query.imageId) : null;
    res.json(getViewsOverTime(imageId, days));
  } catch (err) {
    logger.error('Failed to get timeline stats', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to retrieve timeline data.' });
    }
  }
});

module.exports = router;
