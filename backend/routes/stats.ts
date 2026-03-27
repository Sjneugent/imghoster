import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getImageStats, getViewsOverTime, getImageById } from '../db/index.js';
import logger from '../logger.js';

const router = express.Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req.query.all === '1' && req.session.isAdmin)
      ? null
      : req.session.userId!;
    res.json(await getImageStats(userId));
  } catch (err) {
    logger.error('Failed to get image stats', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to retrieve stats.' });
  }
});

router.get('/timeline', requireAuth, async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const imageId = req.query.imageId ? Number(req.query.imageId) : null;
    const wantsAll = req.query.all === '1';
    const scopedUserId = wantsAll && req.session.isAdmin ? null : req.session.userId!;

    if (req.query.imageId !== undefined) {
      if (!Number.isInteger(imageId) || imageId! <= 0) {
        return res.status(400).json({ error: 'Invalid imageId.' });
      }

      const image = await getImageById(imageId!);
      if (!image) {
        return res.status(404).json({ error: 'Image not found.' });
      }

      if (!(req.session.isAdmin && wantsAll) && image.user_id !== req.session.userId) {
        return res.status(403).json({ error: 'Forbidden.' });
      }
    }

    res.json(await getViewsOverTime(imageId, days, scopedUserId));
  } catch (err) {
    logger.error('Failed to get timeline stats', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to retrieve timeline data.' });
  }
});

export default router;
