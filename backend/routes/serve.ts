import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getImageBySlug, getImageThumbnail, recordView, deleteImage } from '../db/index.js';
import { getStorageProvider } from '../storage/index.js';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytesServer(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Preview router: /p/:slug – server-rendered page with OpenGraph meta tags ──
export const previewRouter = express.Router();

previewRouter.get('/:slug', async (req: Request, res: Response) => {
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

    const host = req.get('host') || 'localhost';
    const protocol = req.secure ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;
    const imageUrl = `${baseUrl}/i/${encodeURIComponent(image.slug)}`;
    const pageUrl = `${baseUrl}/p/${encodeURIComponent(image.slug)}`;
    const title = image.original_name || image.slug;
    const description = image.comment || 'View this image on ImgHoster';
    const isSvg = image.mime_type === 'image/svg+xml';
    const twitterCard = isSvg ? 'summary' : 'summary_large_image';

    const widthMeta = image.width ? `\n  <meta property="og:image:width" content="${image.width}">` : '';
    const heightMeta = image.height ? `\n  <meta property="og:image:height" content="${image.height}">` : '';
    const dimensionsDisplay = image.width && image.height
      ? `<div class="metadata-item"><div class="metadata-label">Dimensions</div><div class="metadata-value">${image.width} × ${image.height}</div></div>`
      : '';
    const tagsDisplay = image.tags
      ? `<div class="metadata-item"><div class="metadata-label">Tags</div><div class="metadata-value" style="font-size:.85rem">${escapeHtml(image.tags)}</div></div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} – ImgHoster</title>
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">${widthMeta}${heightMeta}
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta name="twitter:card" content="${twitterCard}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  <script src="/js/theme.js"></script>
  <link rel="stylesheet" href="/css/style.css">
  <style>
    .preview-shell { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding:2rem; gap:2rem; }
    .preview-img-wrap { max-width:min(90vw,900px); border-radius:8px; overflow:hidden; background:var(--surface); box-shadow:0 4px 16px rgba(0,0,0,.15); }
    .preview-img-wrap img { display:block; max-width:100%; max-height:70vh; object-fit:contain; }
    .preview-info { text-align:center; max-width:700px; width:100%; }
    .preview-info h1 { margin:0 0 1rem; word-break:break-all; font-size:1.4rem; }
    .preview-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:.75rem; margin:1rem 0 1.5rem; font-size:.85rem; }
    .metadata-item { padding:.6rem .75rem; background:var(--surface); border-radius:6px; text-align:left; }
    .metadata-label { color:var(--text-muted); font-weight:600; margin-bottom:.2rem; font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; }
    .metadata-value { color:var(--text); }
    .preview-actions { display:flex; gap:.75rem; justify-content:center; flex-wrap:wrap; }
  </style>
</head>
<body>
  <div class="preview-shell">
    <div class="preview-img-wrap">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" loading="lazy">
    </div>
    <div class="preview-info">
      <h1>${escapeHtml(title)}</h1>
      <div class="preview-meta">
        <div class="metadata-item"><div class="metadata-label">Size</div><div class="metadata-value">${escapeHtml(formatBytesServer(image.size))}</div></div>
        <div class="metadata-item"><div class="metadata-label">Type</div><div class="metadata-value">${escapeHtml(image.mime_type)}</div></div>
        <div class="metadata-item"><div class="metadata-label">Uploaded</div><div class="metadata-value">${escapeHtml(new Date(image.created_at).toLocaleDateString())}</div></div>
        ${dimensionsDisplay}
        ${tagsDisplay}
      </div>
      <div class="preview-actions">
        <a href="${escapeHtml(imageUrl)}" class="btn btn-primary" target="_blank" rel="noopener">Open Image</a>
        <button class="btn btn-secondary" id="btn-copy-link">Copy Link</button>
      </div>
    </div>
  </div>
  <script>
    document.getElementById('btn-copy-link').addEventListener('click', function() {
      var btn = this;
      navigator.clipboard.writeText(window.location.href).then(function() {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = orig; }, 1500);
      });
    });
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(html);
  } catch (err) {
    logger.error('Unexpected error serving preview page', { slug: req.params.slug, error: (err as Error).message });
    if (!res.headersSent) res.status(500).send('Internal server error.');
  }
});

// ── Image serving router: /i/:slug ────────────────────────────────────────────
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

