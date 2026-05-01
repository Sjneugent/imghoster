import './env.js';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import SqliteSessionStore from 'express-session-better-sqlite3';
import { initDB } from './db/index.js';
import { isLocalhost } from './middleware/requireAuth.js';
import { apiTokenMiddleware, requireApiToken } from './middleware/apiToken.js';
import logger from './logger.js';
import authRoutes from './routes/auth.js';
import imagesRoutes from './routes/images.js';
import adminRoutes from './routes/admin.js';
import statsRoutes from './routes/stats.js';
import serveRoutes from './routes/serve.js';
import flagsRoutes from './routes/flags.js';
import albumsRoutes from './routes/albums.js';
import { getExpiredImages, deleteImage } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'imghoster.db');
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_ME_IN_PRODUCTION_imghoster';
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

function resolveCookieSecureSetting(): boolean | 'auto' {
  const raw = process.env.COOKIE_SECURE;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return 'auto';
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();

app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Sessions ──────────────────────────────────────────────────────────────────
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sessionDb = new Database(path.join(dataDir, 'sessions.db'));
const SQLiteStore = SqliteSessionStore(session, sessionDb);

app.use(
  session({
    store: new SQLiteStore(),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'imghoster.sid',
    cookie: {
      httpOnly: true,
      secure: resolveCookieSecureSetting(),
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(csrfTokenMiddleware);

// ── Rate limiting ─────────────────────────────────────────────────────────────
const isTest = process.env.NODE_ENV === 'test';
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 15,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 10000 : 120,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── CSRF protection ───────────────────────────────────────────────────────────
function csrfTokenMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  next();
}

function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  if (process.env.NODE_ENV === 'test') return next();
  if (isLocalhost(req)) return next();
  if (req.apiTokenAuthenticated) return next();

  const token = req.headers['x-csrf-token'];
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    res.status(403).json({ error: 'CSRF check failed.' });
    return;
  }
  next();
}

// ── Static frontend ───────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

app.use(apiTokenMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/flags', generalLimiter, csrfProtect, flagsRoutes);
app.use('/api/images', generalLimiter, requireApiToken, csrfProtect, imagesRoutes);
app.use('/api/admin', generalLimiter, requireApiToken, csrfProtect, adminRoutes);
app.use('/api/stats', generalLimiter, requireApiToken, statsRoutes);
app.use('/api/albums', generalLimiter, requireApiToken, csrfProtect, albumsRoutes);
app.use('/i', generalLimiter, serveRoutes);

app.get('/', (_req: Request, res: Response) => res.redirect('/login.html'));

// ── 404 / global error handler ────────────────────────────────────────────────
app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Not found.' }));

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled request error', {
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── Process-level error handlers ──────────────────────────────────────────────
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('Unhandled rejection', { error: msg, stack });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

async function cleanupExpiredImages(): Promise<void> {
  try {
    const expired = await getExpiredImages();
    for (const img of expired) {
      await deleteImage(img.id).catch(() => {});
      logger.info('Expired image cleaned up', { id: img.id, slug: img.slug });
    }
    if (expired.length > 0) {
      logger.info(`Cleaned up ${expired.length} expired image(s)`);
    }
  } catch (err) {
    logger.error('Expiration cleanup error', { error: (err as Error).message });
  }
}

async function start() {
  await initDB(DB_PATH);

  cleanupTimer = setInterval(cleanupExpiredImages, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();

  const { startScheduler } = await import('./scripts/backup-scheduler.js');
  startScheduler();

  const server = app.listen(Number(PORT), HOST, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : PORT;
    logger.info(`ImgHoster listening on http://${HOST}:${port}`);
  });

  return server;
}

const serverPromise = start().catch((err: Error) => {
  logger.error('Startup failed', { error: err.message, stack: err.stack });
  process.exit(1);
});

export default serverPromise;
