import express from 'express';
import type { Request, Response } from 'express';

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

const router = express.Router();

// ── PUBLIC ROUTES ────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  try {
    const { imageId, flagType, reason, reporterName, reporterEmail, reporterCountry } = req.body;

    if (!imageId || !flagType || !reason) {
      return res.status(400).json({ error: 'Missing required fields: imageId, flagType, reason' });
    }

    const image = await getImageById(imageId);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const validFlagTypes = ['copyright', 'gdpr', 'illegal', 'abuse', 'spam', 'other'];
    if (!validFlagTypes.includes((flagType as string).toLowerCase())) {
      return res.status(400).json({ error: `Invalid flagType. Allowed values: ${validFlagTypes.join(', ')}` });
    }

    if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 5000) {
      return res.status(400).json({ error: 'Reason must be between 10 and 5000 characters' });
    }

    if (reporterEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(reporterEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    const flagId = await createContentFlag({
      imageId,
      flagType: (flagType as string).toLowerCase(),
      reason: (reason as string).trim(),
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
    logger.error('Error creating content flag:', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── ADMIN ROUTES ────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, limit = '50', offset = '0' } = req.query as Record<string, string>;
    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    const flags = await listContentFlags({
      status: status || null,
      limit: limitNum,
      offset: offsetNum,
    });

    const counts = await getFlagCountByStatus();
    const countMap: Record<string, number> = {};
    for (const row of counts) {
      countMap[row.status] = row.count;
    }

    res.json({
      flags,
      pagination: { limit: limitNum, offset: offsetNum, total: Object.values(countMap).reduce((a, b) => a + b, 0) },
      counts: countMap,
    });
  } catch (err) {
    logger.error('Error listing flags:', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:flagId', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const flagId = parseInt(String(req.params.flagId));
    if (!Number.isInteger(flagId) || flagId < 1) {
      return res.status(400).json({ error: 'Invalid flag ID' });
    }

    const flag = await getFlagWithResolutions(flagId);
    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    res.json(flag);
  } catch (err) {
    logger.error('Error fetching flag:', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/image/:imageId', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const imageId = parseInt(String(req.params.imageId));
    if (!Number.isInteger(imageId) || imageId < 1) {
      return res.status(400).json({ error: 'Invalid image ID' });
    }

    const flags = await listContentFlags({ imageId });
    res.json({ flags });
  } catch (err) {
    logger.error('Error fetching image flags:', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:flagId/resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const flagId = parseInt(String(req.params.flagId));
    if (!Number.isInteger(flagId) || flagId < 1) {
      return res.status(400).json({ error: 'Invalid flag ID' });
    }

    const { action, notes, evidenceUrl } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'Missing required field: action' });
    }

    const validActions = ['removed', 'dismissed', 'contacted', 'under-review', 'escalated'];
    if (!validActions.includes((action as string).toLowerCase())) {
      return res.status(400).json({ error: `Invalid action. Allowed values: ${validActions.join(', ')}` });
    }

    const flag = await getContentFlag(flagId);
    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    const resolutionId = await createFlagResolution({
      flagId,
      adminId: req.user!.id,
      action: (action as string).toLowerCase(),
      notes: notes ? String(notes).trim() : null,
      evidenceUrl: evidenceUrl ? String(evidenceUrl).trim() : null,
    });

    await updateFlagStatus(flagId, 'resolved');

    logger.info(`Flag resolved: flag_id=${flagId}, action=${action}, admin_id=${req.user!.id}`);

    res.json({ message: 'Flag resolved successfully', resolutionId, flagId });
  } catch (err) {
    logger.error('Error resolving flag:', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:flagId/status', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const flagId = parseInt(String(req.params.flagId));
    const { status } = req.body;

    if (!Number.isInteger(flagId) || flagId < 1) {
      return res.status(400).json({ error: 'Invalid flag ID' });
    }

    const validStatuses = ['pending', 'reviewing', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed values: ${validStatuses.join(', ')}` });
    }

    const flag = await getContentFlag(flagId);
    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    await updateFlagStatus(flagId, status);

    logger.info(`Flag status updated: flag_id=${flagId}, new_status=${status}`);

    res.json({ message: 'Flag status updated', flagId, status });
  } catch (err) {
    logger.error('Error updating flag status:', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
