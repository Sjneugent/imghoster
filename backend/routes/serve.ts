import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getImageBySlug, getImageThumbnail, recordView, deleteImage } from '../db/index.js';
import { getStorageProvider } from '../storage/index.js';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const image = await getImageBySlug(String(req.params.slug));
    if (!image) {
      logger.warn('Image not found for slug', { slug: req.params.slug });
      return res.status(404).send('Image not found.');
    }

    if (image.visibility === 'private') {
      if (!req.session?.userId || req.session.userId !== image.user_id) {
        return res.status(404).send('Image not found.');
      }
    }

    if (image.expires_at && new Date(image.expires_at) <= new Date()) {
      await deleteImage(image.id).catch(() => {});
      return res.status(410).send('This image has expired.');
    }

    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip;
    const referrer = req.get('referer') || req.get('referrer') || null;
    try { await recordView(image.id, ip ?? null, referrer); } catch (viewErr) {
      logger.warn('Failed to record view', { slug: req.params.slug, error: (viewErr as Error).message });
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const isSvg = image.mime_type === 'image/svg+xml' || path.extname(image.filename).toLowerCase() === '.svg';
    if (isSvg) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="image.svg"');
    } else {
      res.setHeader('Content-Type', image.mime_type);
    }

    // CDN redirect: if the provider supports signed URLs and CDN_BASE_URL is set
    const cdnBaseUrl = process.env.STORAGE_CDN_BASE_URL;
    if (cdnBaseUrl) {
      return res.redirect(302, `${cdnBaseUrl.replace(/\/$/, '')}/${image.filename}`);
    }

    try {
      const data = await getStorageProvider().get(image.filename);
      res.send(data);
      logger.debug('Image served', { slug: req.params.slug, ip, provider: getStorageProvider().name });
    } catch (readErr) {
      logger.warn('Image data missing from storage provider', {
        slug: req.params.slug,
        filename: image.filename,
        error: (readErr as Error).message,
      });
      return res.status(404).send('Image file not found.');
    }
  } catch (err) {
    logger.error('Unexpected error serving image', { slug: req.params.slug, error: (err as Error).message });
    if (!res.headersSent) res.status(500).send('Internal server error.');
  }
});

router.get('/:slug/thumb', async (req: Request, res: Response) => {
  try {
    const image = await getImageBySlug(String(req.params.slug));
    if (!image) return res.status(404).send('Image not found.');

    if (image.visibility === 'private') {
      if (!req.session?.userId || req.session.userId !== image.user_id) {
        return res.status(404).send('Image not found.');
      }
    }

    if (image.expires_at && new Date(image.expires_at) <= new Date()) {
      return res.status(410).send('This image has expired.');
    }

    const thumb = await getImageThumbnail(image.id);
    if (!thumb || !thumb.thumb_data) {
      return res.status(404).send('Thumbnail not available.');
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(thumb.thumb_data));
  } catch (err) {
    logger.error('Error serving thumbnail', { slug: req.params.slug, error: (err as Error).message });
    if (!res.headersSent) res.status(500).send('Internal server error.');
  }
});

export default router;

