import express from 'express';
import type { Request, Response } from 'express';
import { requireAdmin } from '../middleware/requireAuth.js';
import { listUsers, createUser, deleteUser, updateUserPassword, getUserById, setUserStorageQuota, getUserStorageQuota, getUserStorageUsed } from '../db/index.js';
import { runBackup, getSchedulerStatus, updateSchedulerConfig } from '../scripts/backup-scheduler.js';
import logger from '../logger.js';

const router = express.Router();

router.use(requireAdmin);

router.get('/users', async (_req: Request, res: Response) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    logger.error('Failed to list users', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

router.post('/users', async (req: Request, res: Response) => {
  const { username, password, isAdmin } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const id = await createUser(username, password, !!isAdmin);
    logger.info('User created', { id, username, isAdmin: !!isAdmin });
    res.status(201).json({ id, username });
  } catch (err) {
    if ((err as Error).message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    logger.error('Failed to create user', { username, error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create user.' });
  }
});

router.patch('/users/:id/password', async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const user = await getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await updateUserPassword(user.id, password);
    logger.info('User password updated', { userId: user.id, username: user.username });
    res.json({ message: 'Password updated.' });
  } catch (err) {
    logger.error('Failed to update password', { id: req.params.id, error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to update password.' });
  }
});

router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.session.userId) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const user = await getUserById(targetId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await deleteUser(targetId);
    logger.info('User deleted', { userId: targetId, username: user.username });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    logger.error('Failed to delete user', { id: req.params.id, error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to delete user.' });
  }
});

router.patch('/users/:id/quota', async (req: Request, res: Response) => {
  try {
    const user = await getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const quotaBytes = Math.max(0, Number(req.body.quotaBytes) || 0);
    await setUserStorageQuota(user.id, quotaBytes);
    logger.info('User quota updated', { userId: user.id, quotaBytes });
    res.json({ userId: user.id, quotaBytes });
  } catch (err) {
    logger.error('Failed to set quota', { id: req.params.id, error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to set quota.' });
  }
});

router.get('/users/:id/quota', async (req: Request, res: Response) => {
  try {
    const user = await getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const quota = await getUserStorageQuota(user.id);
    const used = await getUserStorageUsed(user.id);
    res.json({ userId: user.id, quotaBytes: quota, usedBytes: used });
  } catch (err) {
    logger.error('Failed to get quota', { id: req.params.id, error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to get quota.' });
  }
});

// ── Backup management ─────────────────────────────────────────────────────────

router.get('/backups/status', async (_req: Request, res: Response) => {
  res.json(getSchedulerStatus());
});

router.post('/backups/run', async (_req: Request, res: Response) => {
  try {
    const result = await runBackup();
    res.json(result);
  } catch (err) {
    logger.error('Manual backup failed', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed.' });
  }
});

router.patch('/backups/config', async (req: Request, res: Response) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.enabled !== undefined) updates.enabled = !!req.body.enabled;
    if (req.body.intervalMs !== undefined) updates.intervalMs = Number(req.body.intervalMs);
    if (req.body.retainCount !== undefined) updates.retainCount = Number(req.body.retainCount);

    const status = updateSchedulerConfig(updates as { enabled?: boolean; intervalMs?: number; retainCount?: number });
    logger.info('Backup scheduler config updated', status as unknown as Record<string, unknown>);
    res.json(status);
  } catch (err) {
    logger.error('Failed to update backup config', { error: (err as Error).message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to update config.' });
  }
});

export default router;
