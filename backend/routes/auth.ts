import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';

import {
  getUserByUsername,
  getUserByEmail,
  verifyPassword,
  createUser,
  createApiToken,
  listApiTokensByUser,
  revokeApiToken,
  saveTotpSecret,
  enableTotp,
  disableTotp,
  getTotpSecret,
  isTotpEnabled,
  updateUserPassword,
  updateUserRealName,
} from '../db/index.js';
import { isLocalhost, requireAuth } from '../middleware/requireAuth.js';
import { hashToken } from '../middleware/apiToken.js';
import logger from '../logger.js';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

const router = express.Router();

function buildCaptchaText(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createCaptchaSvg(text: string): string {
  const chars = text.split('');
  const width = 220;
  const height = 72;
  const colorPalette = ['#1f2937', '#334155', '#0f766e', '#1d4ed8'];

  const noiseLines = Array.from({ length: 8 }).map(() => {
    const x1 = randomBetween(0, width);
    const y1 = randomBetween(0, height);
    const x2 = randomBetween(0, width);
    const y2 = randomBetween(0, height);
    const stroke = colorPalette[randomBetween(0, colorPalette.length - 1)];
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-opacity="0.22" stroke-width="1.6" />`;
  }).join('');

  const dots = Array.from({ length: 18 }).map(() => {
    const cx = randomBetween(0, width);
    const cy = randomBetween(0, height);
    const r = randomBetween(1, 2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#475569" fill-opacity="0.25" />`;
  }).join('');

  const letters = chars.map((ch, i) => {
    const x = 24 + i * 31;
    const y = randomBetween(42, 56);
    const rotate = randomBetween(-18, 18);
    const color = colorPalette[randomBetween(0, colorPalette.length - 1)];
    return `<text x="${x}" y="${y}" fill="${color}" font-size="33" font-family="monospace" font-weight="700" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  ${noiseLines}
  ${dots}
  ${letters}
</svg>`;
}

function sanitizeUsername(raw: unknown): string {
  return String(raw || '').trim();
}

function sanitizeEmail(raw: unknown): string {
  return String(raw || '').trim().toLowerCase();
}

function sanitizeRealName(raw: unknown): string {
  return String(raw || '').trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_-]{3,40}$/.test(username);
}

function buildPlainApiToken(): string {
  return `imh_${crypto.randomBytes(32).toString('hex')}`;
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, rememberMe } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await getUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      logger.warn('Failed login attempt', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const totpEnabled = await isTotpEnabled(user.id);
    if (totpEnabled) {
      const { totpCode } = req.body;
      if (!totpCode) {
        return res.status(206).json({ requiresTotp: true, message: 'Please provide your 2FA code.' });
      }
      const secretRow = await getTotpSecret(user.id);
      if (!secretRow) {
        return res.status(500).json({ error: 'TOTP misconfigured. Contact admin.' });
      }
      const totp = new OTPAuth.TOTP({
        issuer: 'ImgHoster',
        label: user.username,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secretRow.secret),
      });
      const delta = totp.validate({ token: String(totpCode).trim(), window: 1 });
      if (delta === null) {
        return res.status(401).json({ error: 'Invalid 2FA code.' });
      }
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error('Session regeneration failed during login', { error: regenErr.message });
        return res.status(500).json({ error: 'Internal server error.' });
      }

      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      } else {
        req.session.cookie.expires = undefined as unknown as Date;
      }

      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.is_admin === 1;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      logger.info('User logged in', { username: user.username, userId: user.id });

      return res.json({
        id: user.id,
        username: user.username,
        isAdmin: user.is_admin === 1,
        csrfToken: req.session.csrfToken,
      });
    });
  } catch (err) {
    logger.error('Login error', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/auth/captcha
router.get('/captcha', (req: Request, res: Response) => {
  const text = buildCaptchaText(6);
  req.session.captchaText = text;
  req.session.captchaExpiresAt = Date.now() + (5 * 60 * 1000);

  const svg = createCaptchaSvg(text);
  res.json({ svg, expiresInSeconds: 300 });
});

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const email = sanitizeEmail(req.body.email);
    const realName = sanitizeRealName(req.body.realName);
    const password = String(req.body.password || '');
    const captcha = String(req.body.captcha || '').trim().toUpperCase();

    if (!username || !email || !realName || !password || !captcha) {
      return res.status(400).json({ error: 'Email, username, real name, password, and captcha are required.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username must be 3-40 characters and use letters, numbers, underscore, or hyphen.' });
    }
    if (realName.length < 2 || realName.length > 120) {
      return res.status(400).json({ error: 'Real name must be between 2 and 120 characters.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const captchaText = req.session ? String(req.session.captchaText || '').toUpperCase() : '';
    const captchaExpiresAt = req.session ? Number(req.session.captchaExpiresAt || 0) : 0;
    if (!captchaText || Date.now() > captchaExpiresAt || captcha !== captchaText) {
      return res.status(400).json({ error: 'Invalid or expired captcha. Please try again.' });
    }

    req.session.captchaText = null;
    req.session.captchaExpiresAt = null;

    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    const existingEmail = await getUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email is already in use.' });
    }

    const id = await createUser(username, password, false, { email, realName });
    logger.info('User registered', { id, username, email });

    res.status(201).json({
      id, username, email, realName,
      message: 'Account created successfully. Please sign in.',
    });
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE') || (err as Error).message.includes('duplicate key')) {
      return res.status(409).json({ error: 'Username or email already exists.' });
    }
    logger.error('Registration error', { error: (err as Error).message, stack: (err as Error).stack });
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  const username = req.session ? req.session.username : 'unknown';
  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout failed', { error: (err as Error).message });
      return res.status(500).json({ error: 'Could not log out.' });
    }
    res.clearCookie('imghoster.sid');
    logger.info('User logged out', { username });
    res.json({ message: 'Logged out successfully.' });
  });
});

// GET /api/auth/tokens
router.get('/tokens', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const tokens = await listApiTokensByUser(userId);
    res.json(tokens.map((t) => ({
      id: t.id,
      label: t.label,
      expiresAt: t.expires_at,
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at,
      revokedAt: t.revoked_at,
    })));
  } catch (err) {
    logger.error('Failed to list API tokens', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to list API tokens.' });
  }
});

// POST /api/auth/tokens
router.post('/tokens', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const label = String(req.body.label || '').trim().slice(0, 80) || null;
    const durationMinutes = Math.min(Math.max(Number(req.body.durationMinutes) || 60, 5), 60 * 24 * 30);

    const plainToken = buildPlainApiToken();
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
    const id = await createApiToken({
      userId,
      tokenHash: hashToken(plainToken),
      label,
      expiresAt,
    });

    logger.info('API token created', { userId, tokenId: id, expiresAt });
    res.status(201).json({
      id, token: plainToken, expiresAt, label,
      message: 'Store this token now. It will not be shown again.',
    });
  } catch (err) {
    logger.error('Failed to create API token', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create API token.' });
  }
});

// DELETE /api/auth/tokens/:id
router.delete('/tokens/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const tokenId = Number(req.params.id);
    if (!Number.isInteger(tokenId) || tokenId <= 0) {
      return res.status(400).json({ error: 'Invalid token id.' });
    }

    await revokeApiToken(req.session.userId!, tokenId);
    res.json({ message: 'Token revoked.' });
  } catch (err) {
    logger.error('Failed to revoke API token', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to revoke API token.' });
  }
});

// PATCH /api/auth/me – update display name or change password
router.patch('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const { realName, currentPassword, newPassword } = req.body;

    // Change password
    if (currentPassword !== undefined || newPassword !== undefined) {
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Both currentPassword and newPassword are required to change your password.' });
      }
      if (String(newPassword).length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      }
      const user = await getUserByUsername(req.session.username!);
      if (!user || !(await verifyPassword(String(currentPassword), user.password_hash))) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      await updateUserPassword(userId, String(newPassword));
      logger.info('User changed password', { userId });
    }

    // Update display name
    if (realName !== undefined) {
      const trimmed = String(realName || '').trim();
      if (trimmed && (trimmed.length < 2 || trimmed.length > 120)) {
        return res.status(400).json({ error: 'Display name must be between 2 and 120 characters.' });
      }
      await updateUserRealName(userId, trimmed || null);
      logger.info('User updated display name', { userId });
    }

    res.json({ message: 'Account updated successfully.' });
  } catch (err) {
    logger.error('Account update error', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/auth/me
router.get('/me', (req: Request, res: Response) => {  try {
    if (!req.session || !req.session.userId) {
      if (isLocalhost(req)) {
        return res.json({
          id: 0, username: 'localhost-admin', isAdmin: true,
          csrfToken: req.session ? req.session.csrfToken : null,
        });
      }
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    res.json({
      id: req.session.userId,
      username: req.session.username,
      isAdmin: req.session.isAdmin,
      csrfToken: req.session.csrfToken,
    });
  } catch (err) {
    logger.error('Auth check error', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── TOTP 2FA Setup ────────────────────────────────────────────────────────────

router.post('/totp/setup', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const already = await isTotpEnabled(userId);
    if (already) {
      return res.status(400).json({ error: '2FA is already enabled.' });
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: 'ImgHoster',
      label: req.session.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    await saveTotpSecret(userId, secret.base32);
    const uri = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(uri);

    res.json({ secret: secret.base32, qrDataUrl, uri });
  } catch (err) {
    logger.error('TOTP setup error', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to set up 2FA.' });
  }
});

router.post('/totp/enable', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const secretRow = await getTotpSecret(userId);
    if (!secretRow) {
      return res.status(400).json({ error: 'Run TOTP setup first.' });
    }
    if (secretRow.enabled) {
      return res.status(400).json({ error: '2FA is already enabled.' });
    }

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Verification code is required.' });

    const totp = new OTPAuth.TOTP({
      issuer: 'ImgHoster',
      label: req.session.username,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretRow.secret),
    });

    const delta = totp.validate({ token: String(code).trim(), window: 1 });
    if (delta === null) {
      return res.status(401).json({ error: 'Invalid verification code.' });
    }

    await enableTotp(userId);
    res.json({ message: '2FA enabled successfully.' });
  } catch (err) {
    logger.error('TOTP enable error', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to enable 2FA.' });
  }
});

router.post('/totp/disable', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const enabled = await isTotpEnabled(userId);
    if (!enabled) {
      return res.status(400).json({ error: '2FA is not enabled.' });
    }

    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to disable 2FA.' });

    const user = await getUserByUsername(req.session.username!);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid password.' });
    }

    await disableTotp(userId);
    res.json({ message: '2FA disabled.' });
  } catch (err) {
    logger.error('TOTP disable error', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to disable 2FA.' });
  }
});

router.get('/totp/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const enabled = await isTotpEnabled(req.session.userId!);
    res.json({ enabled });
  } catch (err) {
    logger.error('TOTP status error', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to check 2FA status.' });
  }
});

export default router;
