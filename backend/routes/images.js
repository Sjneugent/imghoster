import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import yazl from 'yazl';
import { fileURLToPath } from 'node:url';
import { createImage, getImageById, listImagesByUser, listAllImages, deleteImage, slugExists, searchImages, getImagesByIds, getImageBlobByImageId, checkDuplicateHash, upsertImageBlob, listUsers, upsertImageThumbnail, getUserStorageUsed, getUserStorageQuota, updateImageVisibility, updateImageExpiration, } from '../db/index.js';
import { requireAuth, isLocalhost } from '../middleware/requireAuth.js';
import logger from '../logger.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
const STORAGE_MODE = (process.env.IMAGE_STORAGE_MODE || 'file').toLowerCase();
const USE_DB_BLOBS = STORAGE_MODE === 'blob' || STORAGE_MODE === 'dbblob';
const MAX_FILE_SIZE_BYTES = Number(process.env.MAX_UPLOAD_FILE_SIZE_BYTES || 10 * 1024 * 1024);
const ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
]);
const COMPRESSIBLE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const router = express.Router();
function extensionFromMime(mimeType) {
    switch (mimeType) {
        case 'image/jpeg': return '.jpg';
        case 'image/png': return '.png';
        case 'image/gif': return '.gif';
        case 'image/webp': return '.webp';
        case 'image/svg+xml': return '.svg';
        default: return '.bin';
    }
}
async function validateUploadedImage(file) {
    const expectedByMime = {
        'image/jpeg': 'jpeg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
    };
    const expected = expectedByMime[file.mimetype];
    if (!expected) {
        throw new Error('Unsupported image MIME type.');
    }
    const bytes = await getUploadedFileBytes(file);
    if (file.mimetype === 'image/jpeg') {
        if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[bytes.length - 2] !== 0xFF || bytes[bytes.length - 1] !== 0xD9) {
            throw new Error('Invalid JPEG file header/footer.');
        }
    }
    else if (file.mimetype === 'image/png') {
        const pngSig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        if (bytes.length < 8 || !pngSig.every((b, i) => bytes[i] === b)) {
            throw new Error('Invalid PNG file signature.');
        }
    }
    else if (file.mimetype === 'image/gif') {
        const sig = bytes.subarray(0, 6).toString('ascii');
        if (sig !== 'GIF87a' && sig !== 'GIF89a') {
            throw new Error('Invalid GIF file signature.');
        }
    }
    else if (file.mimetype === 'image/webp') {
        const riff = bytes.subarray(0, 4).toString('ascii');
        const webp = bytes.subarray(8, 12).toString('ascii');
        if (bytes.length < 12 || riff !== 'RIFF' || webp !== 'WEBP') {
            throw new Error('Invalid WebP file signature.');
        }
    }
    else if (file.mimetype === 'image/svg+xml') {
        const text = bytes.toString('utf8').trim();
        if (!text.startsWith('<') || !/<svg(?:\s|>)/i.test(text)) {
            throw new Error('Invalid SVG root element.');
        }
    }
    let metadata;
    try {
        metadata = await sharp(bytes, { animated: true }).metadata();
    }
    catch (_err) {
        throw new Error('Corrupt or unreadable image data.');
    }
    if (!metadata?.format) {
        throw new Error('Unable to detect image format.');
    }
    if (metadata.format !== expected) {
        throw new Error(`File content does not match declared type (${expected.toUpperCase()}).`);
    }
}
async function getUploadedFileBytes(file) {
    if (Buffer.isBuffer(file.buffer)) {
        return file.buffer;
    }
    return fs.promises.readFile(file.path);
}
async function cleanupUploadedFile(file) {
    if (file?.path) {
        await fs.promises.unlink(file.path).catch(() => { });
    }
}
async function compressUploadedImage(file) {
    const originalSize = file.size;
    const mimeType = file.mimetype;
    if (!COMPRESSIBLE_MIME.has(mimeType)) {
        return { applied: false, originalSize, finalSize: originalSize, mimeType };
    }
    const input = Buffer.isBuffer(file.buffer) ? file.buffer : file.path;
    let pipeline = sharp(input, { animated: true });
    if (mimeType === 'image/jpeg') {
        pipeline = pipeline.jpeg({ quality: 78, mozjpeg: true });
    }
    else if (mimeType === 'image/png') {
        pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    }
    else if (mimeType === 'image/webp') {
        pipeline = pipeline.webp({ quality: 78, effort: 4 });
    }
    const compressedBuffer = await pipeline.toBuffer();
    if (compressedBuffer.length >= originalSize) {
        return { applied: false, originalSize, finalSize: originalSize, mimeType };
    }
    if (Buffer.isBuffer(file.buffer)) {
        file.buffer = compressedBuffer;
        file.size = compressedBuffer.length;
    }
    else {
        await fs.promises.writeFile(file.path, compressedBuffer);
    }
    return {
        applied: true,
        originalSize,
        finalSize: compressedBuffer.length,
        mimeType,
    };
}
async function stripExifData(file) {
    if (!COMPRESSIBLE_MIME.has(file.mimetype))
        return;
    const input = Buffer.isBuffer(file.buffer) ? file.buffer : file.path;
    const stripped = await sharp(input, { animated: true })
        .rotate()
        .withMetadata({ orientation: undefined })
        .toBuffer();
    if (Buffer.isBuffer(file.buffer)) {
        file.buffer = stripped;
        file.size = stripped.length;
    }
    else {
        await fs.promises.writeFile(file.path, stripped);
        file.size = stripped.length;
    }
}
const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 300;
async function generateThumbnail(bytes, mimeType) {
    if (mimeType === 'image/svg+xml' || mimeType === 'image/gif')
        return null;
    try {
        const thumb = await sharp(bytes)
            .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 60 })
            .toBuffer();
        const meta = await sharp(thumb).metadata();
        return { data: thumb, width: meta.width, height: meta.height };
    }
    catch {
        return null;
    }
}
const VALID_VISIBILITY = new Set(['public', 'unlisted', 'private']);
function sanitizeVisibility(raw) {
    const val = String(raw || 'public').trim().toLowerCase();
    return VALID_VISIBILITY.has(val) ? val : 'public';
}
function parseExpiresAt(raw) {
    if (!raw)
        return null;
    const d = new Date(String(raw));
    if (isNaN(d.getTime()) || d <= new Date())
        return null;
    return d.toISOString();
}
function sanitiseSlug(raw) {
    return String(raw)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 120);
}
function parseBooleanFlag(raw) {
    if (raw === undefined || raw === null)
        return false;
    const val = String(raw).trim().toLowerCase();
    return val === 'true' || val === '1' || val === 'on' || val === 'yes';
}
function sanitizeComment(raw) {
    const val = String(raw || '').trim();
    return val ? val.slice(0, 1000) : null;
}
function sanitizeTags(raw) {
    const val = String(raw || '').trim();
    if (!val)
        return null;
    const unique = [...new Set(val.split(',')
            .map(t => t.trim().toLowerCase())
            .filter(Boolean)
            .map(t => t.slice(0, 32)))];
    return unique.length ? unique.slice(0, 20).join(', ') : null;
}
async function getLocalhostFallbackUserId() {
    const users = await listUsers();
    const admin = users.find(u => u.is_admin === 1);
    return admin ? admin.id : (users.length > 0 ? users[0].id : null);
}
const storage = USE_DB_BLOBS
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination(_req, _file, cb) {
            cb(null, UPLOADS_DIR);
        },
        filename(_req, file, cb) {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `${uuidv4()}${ext}`);
        },
    });
const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 5 },
    fileFilter(_req, file, cb) {
        if (ALLOWED_MIME.has(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed.'));
        }
    },
});
// ── Duplicate Detection ────────────────────────────────────────────────────────
router.post('/check-hash', async (req, res) => {
    try {
        const { fileHash } = req.body;
        if (!fileHash) {
            return res.status(400).json({ error: 'Missing fileHash' });
        }
        const duplicate = await checkDuplicateHash(fileHash);
        if (duplicate) {
            return res.status(409).json({
                isDuplicate: true,
                message: 'Image already uploaded. Please upload a unique image.',
                existing: {
                    id: duplicate.id,
                    slug: duplicate.slug,
                    originalName: duplicate.original_name,
                    uploadedAt: duplicate.created_at,
                    uploadedBy: duplicate.user_id,
                },
            });
        }
        res.json({
            isDuplicate: false,
            message: 'File is unique and can be uploaded.',
        });
    }
    catch (err) {
        logger.error('Error checking file hash:', { error: err.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Upload ────────────────────────────────────────────────────────────────────
router.post('/upload', requireAuth, upload.array('image', 5), async (req, res) => {
    try {
        const files = Array.isArray(req.files) ? req.files : [];
        if (files.length === 0) {
            return res.status(400).json({ error: 'No image files provided.' });
        }
        for (const file of files) {
            try {
                await validateUploadedImage(file);
            }
            catch (validationErr) {
                await Promise.all(files.map((f) => cleanupUploadedFile(f)));
                return res.status(400).json({
                    error: `Invalid image file "${file.originalname}": ${validationErr.message}`,
                });
            }
        }
        const customSlug = req.body.slug ? sanitiseSlug(req.body.slug) : '';
        if (customSlug && files.length > 1) {
            await Promise.all(files.map((f) => cleanupUploadedFile(f)));
            return res.status(400).json({ error: 'Custom slug can only be used when uploading a single image.' });
        }
        const planned = [];
        for (let i = 0; i < files.length; i += 1) {
            const file = files[i];
            let slug = customSlug;
            if (!slug) {
                slug = file.filename
                    ? path.basename(file.filename, path.extname(file.filename))
                    : uuidv4();
            }
            if (await slugExists(slug)) {
                await Promise.all(files.map((f) => cleanupUploadedFile(f)));
                return res.status(409).json({ error: `The URL slug "${slug}" is already taken.` });
            }
            planned.push({ file, slug });
        }
        const compressRequested = parseBooleanFlag(req.body.compress);
        const comment = sanitizeComment(req.body.comment);
        const tags = sanitizeTags(req.body.tags);
        const fileHash = req.body.fileHash || null;
        const visibility = sanitizeVisibility(req.body.visibility);
        const expiresAt = parseExpiresAt(req.body.expiresAt);
        const userId = req.session.userId || (isLocalhost(req) ? await getLocalhostFallbackUserId() : null);
        if (!userId) {
            await Promise.all(files.map((f) => cleanupUploadedFile(f)));
            logger.warn('Upload rejected: no user available', { ip: req.ip });
            return res.status(500).json({ error: 'No user available to associate upload with.' });
        }
        // ── Storage quota check ──────────────────────────────────────────────────
        const quota = await getUserStorageQuota(userId);
        if (quota > 0) {
            const used = await getUserStorageUsed(userId);
            const totalIncoming = files.reduce((sum, f) => sum + f.size, 0);
            if (used + totalIncoming > quota) {
                await Promise.all(files.map((f) => cleanupUploadedFile(f)));
                const usedMB = (used / (1024 * 1024)).toFixed(1);
                const quotaMB = (quota / (1024 * 1024)).toFixed(1);
                return res.status(413).json({
                    error: `Storage quota exceeded. Used ${usedMB} MB of ${quotaMB} MB.`,
                });
            }
        }
        const host = req.get('host') || 'localhost';
        const protocol = req.secure ? 'https' : 'http';
        const uploaded = [];
        for (const item of planned) {
            let compression = {
                requested: compressRequested,
                applied: false,
                originalSize: item.file.size,
                finalSize: item.file.size,
            };
            if (compressRequested) {
                try {
                    const result = await compressUploadedImage(item.file);
                    compression = {
                        requested: true,
                        applied: result.applied,
                        originalSize: result.originalSize,
                        finalSize: result.finalSize,
                    };
                }
                catch (compressErr) {
                    logger.warn('Image compression failed; continuing with original file', {
                        filename: item.file.filename,
                        mimeType: item.file.mimetype,
                        error: compressErr.message,
                    });
                }
            }
            let blobBuffer = null;
            if (USE_DB_BLOBS) {
                blobBuffer = await getUploadedFileBytes(item.file);
            }
            const storageFilename = USE_DB_BLOBS
                ? `${item.slug}${extensionFromMime(item.file.mimetype)}`
                : item.file.filename;
            let id = null;
            try {
                id = await createImage({
                    filename: storageFilename,
                    originalName: item.file.originalname,
                    slug: item.slug,
                    mimeType: item.file.mimetype,
                    size: compression.finalSize,
                    comment,
                    tags,
                    fileHash: files.length === 1 ? fileHash : null,
                    storageBackend: USE_DB_BLOBS ? 'db_blob' : 'file',
                    userId,
                    visibility,
                    expiresAt,
                });
                if (USE_DB_BLOBS && blobBuffer) {
                    await upsertImageBlob(id, blobBuffer);
                    await cleanupUploadedFile(item.file);
                }
                const thumbBytes = blobBuffer || await getUploadedFileBytes(item.file);
                const thumb = await generateThumbnail(thumbBytes, item.file.mimetype);
                if (thumb) {
                    await upsertImageThumbnail(id, thumb.data, thumb.width ?? 0, thumb.height ?? 0);
                }
            }
            catch (persistErr) {
                if (id) {
                    await deleteImage(id).catch(() => { });
                }
                throw persistErr;
            }
            logger.info('Image uploaded', {
                id,
                slug: item.slug,
                userId,
                filename: storageFilename,
                storage: USE_DB_BLOBS ? 'db_blob' : 'file',
            });
            uploaded.push({
                id,
                slug: item.slug,
                url: `${protocol}://${host}/i/${item.slug}`,
                comment,
                tags,
                visibility,
                expiresAt,
                compression,
            });
        }
        if (uploaded.length === 1) {
            return res.status(201).json(uploaded[0]);
        }
        return res.status(201).json({
            uploaded,
            count: uploaded.length,
        });
    }
    catch (err) {
        logger.error('Upload failed', { error: err.message, stack: err.stack });
        if (Array.isArray(req.files)) {
            await Promise.all(req.files.map((f) => cleanupUploadedFile(f)));
        }
        if (!res.headersSent) {
            res.status(500).json({ error: 'Upload failed due to an internal error.' });
        }
    }
});
// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        const showAll = req.query.all === '1';
        if (query) {
            const isAdmin = showAll && (req.session.isAdmin || isLocalhost(req));
            const userId = isAdmin ? null : (req.session.userId || null);
            if (isLocalhost(req) && !req.session.userId) {
                return res.json(await searchImages(query, null, true));
            }
            return res.json(await searchImages(query, userId ?? null, !!isAdmin));
        }
        if (isLocalhost(req) && !req.session.userId) {
            return res.json(await listAllImages());
        }
        if (showAll && (req.session.isAdmin || isLocalhost(req))) {
            return res.json(await listAllImages());
        }
        res.json(await listImagesByUser(req.session.userId));
    }
    catch (err) {
        logger.error('Failed to list images', { error: err.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to retrieve images.' });
        }
    }
});
// ── Bulk download as zip ──────────────────────────────────────────────────────
router.post('/download', requireAuth, async (req, res) => {
    try {
        const ids = req.body.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Provide an array of image IDs.' });
        }
        if (ids.length > 500) {
            return res.status(400).json({ error: 'Too many images. Maximum 500 per download.' });
        }
        const safeIds = [...new Set(ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))];
        if (safeIds.length === 0) {
            return res.status(400).json({ error: 'No valid image IDs provided.' });
        }
        const images = await getImagesByIds(safeIds);
        if (images.length === 0) {
            return res.status(404).json({ error: 'No images found.' });
        }
        if (!isLocalhost(req) && !req.session.isAdmin) {
            const unauthorized = images.find(img => img.user_id !== req.session.userId);
            if (unauthorized) {
                return res.status(403).json({ error: 'Forbidden: you can only download your own images.' });
            }
        }
        const missing = images.filter(img => img.storage_backend !== 'db_blob' && !fs.existsSync(path.join(UPLOADS_DIR, img.filename)));
        if (missing.length > 0) {
            logger.warn('Download requested for missing files', { missing: missing.map(m => m.filename) });
        }
        const available = images.filter(img => img.storage_backend === 'db_blob' || fs.existsSync(path.join(UPLOADS_DIR, img.filename)));
        if (available.length === 0) {
            return res.status(404).json({ error: 'No images available.' });
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="images.zip"');
        const zipfile = new yazl.ZipFile();
        zipfile.outputStream.on('error', (err) => {
            logger.error('Zip stream error', { error: err.message });
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to create zip archive.' });
            }
        });
        zipfile.outputStream.pipe(res);
        const usedNames = new Set();
        for (const img of available) {
            const ext = path.extname(img.filename) || extensionFromMime(img.mime_type);
            let name = img.slug + ext;
            if (usedNames.has(name)) {
                name = `${img.slug}_${img.id}${ext}`;
            }
            usedNames.add(name);
            if (img.storage_backend === 'db_blob') {
                const blobRow = await getImageBlobByImageId(img.id);
                if (blobRow?.blob_data) {
                    zipfile.addBuffer(blobRow.blob_data, name);
                }
            }
            else {
                zipfile.addFile(path.join(UPLOADS_DIR, img.filename), name);
            }
        }
        zipfile.end();
        logger.info('Bulk download', { count: available.length, ids: safeIds });
    }
    catch (err) {
        logger.error('Download failed', { error: err.message, stack: err.stack });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed.' });
        }
    }
});
// ── Single image metadata ─────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const image = await getImageById(Number(req.params.id));
        if (!image)
            return res.status(404).json({ error: 'Image not found.' });
        if (!isLocalhost(req) && !req.session.isAdmin && image.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        res.json(image);
    }
    catch (err) {
        logger.error('Failed to get image metadata', { id: req.params.id, error: err.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to retrieve image.' });
        }
    }
});
// ── Update visibility ─────────────────────────────────────────────────────────
router.patch('/:id/visibility', requireAuth, async (req, res) => {
    try {
        const image = await getImageById(Number(req.params.id));
        if (!image)
            return res.status(404).json({ error: 'Image not found.' });
        if (!isLocalhost(req) && !req.session.isAdmin && image.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        const visibility = sanitizeVisibility(req.body.visibility);
        await updateImageVisibility(image.id, visibility);
        res.json({ id: image.id, visibility });
    }
    catch (err) {
        logger.error('Failed to update visibility', { id: req.params.id, error: err.message });
        if (!res.headersSent)
            res.status(500).json({ error: 'Failed to update visibility.' });
    }
});
// ── Update expiration ─────────────────────────────────────────────────────────
router.patch('/:id/expiration', requireAuth, async (req, res) => {
    try {
        const image = await getImageById(Number(req.params.id));
        if (!image)
            return res.status(404).json({ error: 'Image not found.' });
        if (!isLocalhost(req) && !req.session.isAdmin && image.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        const expiresAt = req.body.expiresAt ? parseExpiresAt(req.body.expiresAt) : null;
        await updateImageExpiration(image.id, expiresAt);
        res.json({ id: image.id, expiresAt });
    }
    catch (err) {
        logger.error('Failed to update expiration', { id: req.params.id, error: err.message });
        if (!res.headersSent)
            res.status(500).json({ error: 'Failed to update expiration.' });
    }
});
// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const image = await getImageById(Number(req.params.id));
        if (!image)
            return res.status(404).json({ error: 'Image not found.' });
        if (!isLocalhost(req) && !req.session.isAdmin && image.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        if (image.storage_backend !== 'db_blob') {
            const filePath = path.join(UPLOADS_DIR, image.filename);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    logger.warn('Failed to delete image file from disk', { filename: image.filename, error: unlinkErr.message });
                }
            });
        }
        await deleteImage(image.id);
        logger.info('Image deleted', { id: image.id, slug: image.slug });
        res.json({ message: 'Image deleted.' });
    }
    catch (err) {
        logger.error('Failed to delete image', { id: req.params.id, error: err.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to delete image.' });
        }
    }
});
// Multer error handler
router.use((err, _req, res, _next) => {
    logger.warn('Upload error', { error: err.message });
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'You can upload up to 5 images at once.' });
    }
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024));
        return res.status(400).json({ error: `Each image must be ${maxMb} MB or smaller.` });
    }
    res.status(400).json({ error: err.message || 'Upload error.' });
});
export default router;
//# sourceMappingURL=images.js.map