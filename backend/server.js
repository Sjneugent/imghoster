import dotenv from 'dotenv';
import express from 'express';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'imghoster.db');
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_ME_IN_PRODUCTION_imghoster';
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

function resolveCookieSecureSetting() {
  const raw = process.env.COOKIE_SECURE;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  // Default to auto so cookies are secure on HTTPS and still work on local HTTP.
  return 'auto';
}

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();

// Trust reverse proxy (nginx)
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
      maxAge: 24 * 60 * 60 * 1000, // 1 day default; extended to 30d on "remember me"
    },
  })
);

// Ensure every session gets a CSRF token
app.use(csrfTokenMiddleware);

// ── Rate limiting ─────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── CSRF protection (synchronizer token pattern) ──────────────────────────────
//
// On every authenticated GET /api/auth/me the server returns a fresh CSRF token
// bound to the session. Mutating requests (POST/PUT/PATCH/DELETE) must echo it
// back in the X-CSRF-Token header.
//
function csrfTokenMiddleware(req, _res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  next();
}

function csrfProtect(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  // Test mode bypasses CSRF
  if (process.env.NODE_ENV === 'test') return next();

  // Localhost bypasses CSRF
  if (isLocalhost(req)) return next();

  // API token-authenticated requests do not require CSRF synchronizer token.
  if (req.apiTokenAuthenticated) return next();

  const token = req.headers['x-csrf-token'];
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'CSRF check failed.' });
  }
  next();
}

// ── Static frontend ───────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Parse and validate API token (if supplied).
app.use(apiTokenMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/flags', generalLimiter, csrfProtect, flagsRoutes); // Public for POST (report), admin for GET (review)
app.use('/api/images', generalLimiter, requireApiToken, csrfProtect, imagesRoutes);
app.use('/api/admin', generalLimiter, requireApiToken, csrfProtect, adminRoutes);
app.use('/api/stats', generalLimiter, requireApiToken, statsRoutes);
app.use('/i', generalLimiter, serveRoutes); // public image serving

// Root redirect
app.get('/', (_req, res) => res.redirect('/login.html'));

// ── 404 / global error handler ────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
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
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('Unhandled rejection', { error: msg, stack });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function start() {
  await initDB(DB_PATH);

  const server = app.listen(PORT, HOST, () => {
    logger.info(`ImgHoster listening on http://${HOST}:${server.address().port}`);
  });

  return server;
}

const serverPromise = start().catch((err) => {
  logger.error('Startup failed', { error: err.message, stack: err.stack });
  process.exit(1);
});

export default serverPromise;
