import type { Request, Response, NextFunction } from 'express';

function localhostBypassEnabled(): boolean {
  const val = process.env.LOCALHOST_BYPASS;
  if (val === undefined || val === null) return true;
  return val !== 'false' && val !== '0';
}

function isLocalhost(req: Request): boolean {
  if (!localhostBypassEnabled()) return false;
  const ip = req.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isLocalhost(req)) return next();
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.redirect('/login.html');
    return;
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isLocalhost(req)) return next();
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!req.session.isAdmin) {
    res.status(403).json({ error: 'Admin privileges required.' });
    return;
  }
  next();
}

export { requireAuth, requireAdmin, isLocalhost };
