'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const SqliteSessionStore = require('express-session-better-sqlite3');
const { initDB } = require('./db');
const { isLocalhost } = require('./middleware/requireAuth');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'imghoster.db');
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_ME_IN_PRODUCTION_imghoster';
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

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
      secure: process.env.NODE_ENV === 'production',
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

  const token = req.headers['x-csrf-token'];
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'CSRF check failed.' });
  }
  next();
}

// ── Static frontend ───────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', loginLimiter, require('./routes/auth'));
app.use('/api/images', generalLimiter, csrfProtect, require('./routes/images'));
app.use('/api/admin', generalLimiter, csrfProtect, require('./routes/admin'));
app.use('/api/stats', generalLimiter, require('./routes/stats'));
app.use('/i', generalLimiter, require('./routes/serve')); // public image serving

// Root redirect
app.get('/', (_req, res) => res.redirect('/login.html'));

// ── 404 / global error handler ────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
initDB(DB_PATH);
const server = app.listen(PORT, HOST, () => {
  console.log(`ImgHoster listening on http://${HOST}:${server.address().port}`);
});

module.exports = server;
