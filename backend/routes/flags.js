import express from 'express';
const router = express.Router();

import {
  createContentFlag,
  getContentFlag,
  listContentFlags,
  getFlagCountByStatus,
  updateFlagStatus,
  createFlagResolution,
  getFlagWithResolutions,
  getImageById,
} from '../db/index.js';

import { requireAuth } from '../middleware/requireAuth.js';
import logger from '../logger.js';

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/flags
 * Create a new content flag for legal compliance
 * 
 * Body:
 *   - imageId (number): ID of the flagged image
 *   - flagType (string): Type of flag (copyright, gdpr, illegal, abuse, spam)
 *   - reason (string): Detailed explanation of why content is being flagged
 *   - reporterName (string, optional): Name of the person filing the report
 *   - reporterEmail (string, optional): Email address for follow-up
 *   - reporterCountry (string, optional): ISO country code of the reporter
 */
router.post('/', async (req, res) => {
  try {
    const { imageId, flagType, reason, reporterName, reporterEmail, reporterCountry } = req.body;

    // Validate required fields
    if (!imageId || !flagType || !reason) {
      return res.status(400).json({
        error: 'Missing required fields: imageId, flagType, reason',
      });
    }

    // Validate image exists
    const image = await getImageById(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Validate flagType
    const validFlagTypes = ['copyright', 'gdpr', 'illegal', 'abuse', 'spam', 'other'];
    if (!validFlagTypes.includes(flagType.toLowerCase())) {
      return res.status(400).json({
        error: `Invalid flagType. Allowed values: ${validFlagTypes.join(', ')}`,
      });
    }

    // Validate reason length
    if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 5000) {
      return res.status(400).json({
        error: 'Reason must be between 10 and 5000 characters',
      });
    }

    // Validate email format if provided
    if (reporterEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(reporterEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    // Create the flag
    const flagId = await createContentFlag({
      imageId,
      flagType: flagType.toLowerCase(),
      reason: reason.trim(),
      reporterName: reporterName ? String(reporterName).trim() : null,
      reporterEmail: reporterEmail ? String(reporterEmail).trim() : null,
      reporterCountry: reporterCountry ? String(reporterCountry).trim().toUpperCase() : null,
    });

    logger.info(`Content flag created: flag_id=${flagId}, image_id=${imageId}, type=${flagType}`);

    res.status(201).json({
      message: 'Your report has been submitted. We will review it promptly.',
      flagId,
    });
  } catch (err) {
    logger.error('Error creating content flag:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/flags
 * List all content flags (paginated)
 * Query parameters:
 *   - status: Filter by status (pending, reviewing, resolved, dismissed)
 *   - limit: Items per page (default 50, max 200)
 *   - offset: Pagination offset (default 0)
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, limit = 50, offset = 0 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    const flags = await listContentFlags({
      status: status || null,
      limit: limitNum,
      offset: offsetNum,
    });

    const counts = await getFlagCountByStatus();
    const countMap = {};
    for (const row of counts) {
      countMap[row.status] = row.count;
    }

    res.json({
      flags,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        total: Object.values(countMap).reduce((a, b) => a + b, 0),
      },
      counts: countMap,
    });
  } catch (err) {
    logger.error('Error listing flags:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/flags/:flagId
 * Get detailed information about a specific flag
 */
router.get('/:flagId', requireAuth, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const flagId = parseInt(req.params.flagId);
    if (!Number.isInteger(flagId) || flagId < 1) {
      return res.status(400).json({ error: 'Invalid flag ID' });
    }

    const flag = await getFlagWithResolutions(flagId);
    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    res.json(flag);
  } catch (err) {
    logger.error('Error fetching flag:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/flags/image/:imageId
 * Get all flags for a specific image
 */
router.get('/image/:imageId', requireAuth, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const imageId = parseInt(req.params.imageId);
    if (!Number.isInteger(imageId) || imageId < 1) {
      return res.status(400).json({ error: 'Invalid image ID' });
    }

    const flags = await listContentFlags({ imageId });
    res.json({ flags });
  } catch (err) {
    logger.error('Error fetching image flags:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/flags/:flagId/resolve
 * Resolve a flag by taking action (remove content, dismiss, contact requester, etc.)
 * 
 * Body:
 *   - action (string): Type of action taken (removed, dismissed, contacted, under-review)
 *   - notes (string, optional): Admin notes about the resolution
 *   - evidenceUrl (string, optional): URL to legal documentation or evidence
 */
router.post('/:flagId/resolve', requireAuth, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const flagId = parseInt(req.params.flagId);
    if (!Number.isInteger(flagId) || flagId < 1) {
      return res.status(400).json({ error: 'Invalid flag ID' });
    }

    const { action, notes, evidenceUrl } = req.body;

    // Validate required fields
    if (!action) {
      return res.status(400).json({ error: 'Missing required field: action' });
    }

    // Validate action type
    const validActions = ['removed', 'dismissed', 'contacted', 'under-review', 'escalated'];
    if (!validActions.includes(action.toLowerCase())) {
      return res.status(400).json({
        error: `Invalid action. Allowed values: ${validActions.join(', ')}`,
      });
    }

    // Verify flag exists
    const flag = await getContentFlag(flagId);
    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    // Create resolution record
    const resolutionId = await createFlagResolution({
      flagId,
      adminId: req.user.id,
      action: action.toLowerCase(),
      notes: notes ? String(notes).trim() : null,
      evidenceUrl: evidenceUrl ? String(evidenceUrl).trim() : null,
    });

    // Update flag status
    await updateFlagStatus(flagId, 'resolved');

    logger.info(
      `Flag resolved: flag_id=${flagId}, action=${action}, admin_id=${req.user.id}`
    );

    res.json({
      message: 'Flag resolved successfully',
      resolutionId,
      flagId,
    });
  } catch (err) {
    logger.error('Error resolving flag:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/flags/:flagId/status
 * Update the status of a flag (pending, reviewing, resolved, dismissed)
 */
router.patch('/:flagId/status', requireAuth, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const flagId = parseInt(req.params.flagId);
    const { status } = req.body;

    if (!Number.isInteger(flagId) || flagId < 1) {
      return res.status(400).json({ error: 'Invalid flag ID' });
    }

    const validStatuses = ['pending', 'reviewing', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed values: ${validStatuses.join(', ')}`,
      });
    }

    const flag = await getContentFlag(flagId);
    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    await updateFlagStatus(flagId, status);

    logger.info(`Flag status updated: flag_id=${flagId}, new_status=${status}`);

    res.json({
      message: 'Flag status updated',
      flagId,
      status,
    });
  } catch (err) {
    logger.error('Error updating flag status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
