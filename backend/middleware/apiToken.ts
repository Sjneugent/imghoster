import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getActiveApiTokenByHash, touchApiTokenUsage } from '../db/index.js';
import { isLocalhost } from './requireAuth.js';

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  const xApiToken = req.headers['x-api-token'];
  if (xApiToken && String(xApiToken).trim()) {
    return String(xApiToken).trim();
  }

  return null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function apiTokenMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.apiTokenAuthenticated = false;

  const token = extractToken(req);
  if (!token) return next();

  const record = await getActiveApiTokenByHash(hashToken(token));
  if (!record) return next();

  req.apiTokenAuthenticated = true;
  req.apiTokenId = record.id;

  if (req.session) {
    req.session.userId = record.user_id;
    req.session.username = record.username;
    req.session.isAdmin = !!(record.is_admin);
  }

  touchApiTokenUsage(record.id).catch(() => {});
  return next();
}

function requireApiToken(req: Request, res: Response, next: NextFunction): void {
  if (isLocalhost(req)) return next();
  if (req.apiTokenAuthenticated) return next();
  res.status(401).json({ error: 'Valid API token required.' });
}

export {
  apiTokenMiddleware,
  requireApiToken,
  extractToken,
  hashToken,
};
