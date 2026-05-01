import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * IP-keyed rate limiter for the upload endpoint (15-minute sliding window).
 * In test mode the cap is raised to 10 000 to avoid interfering with the test suite.
 */
const isTest = process.env.NODE_ENV === 'test';
const uploadLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: isTest ? 10000 : (parseInt(process.env.UPLOAD_RATE_LIMIT_MAX ?? '', 10) || 30),
  message: { error: 'Upload rate limit exceeded. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});


const userUploadTimestamps = new Map<number, number[]>();

// Concurrent upload tracking: ip → number of in-flight upload requests
const concurrentUploads = new Map<string, number>();

function getMaxUploadsPerUser(): number {
  const val = parseInt(process.env.USER_UPLOAD_RATE_LIMIT_MAX ?? '', 10);
  if (!isNaN(val) && val > 0) return val;
  // Default to a permissive limit in test mode so normal test suites are unaffected.
  return process.env.NODE_ENV === 'test' ? 10000 : 20;
}

function getMaxConcurrentUploads(): number {
  const val = parseInt(process.env.MAX_CONCURRENT_UPLOADS ?? '', 10);
  if (!isNaN(val) && val > 0) return val;
  return process.env.NODE_ENV === 'test' ? 1000 : 3;
}

/**
 * Sliding-window per-user upload rate limiter.
 * Must be placed after session/auth middleware so req.session.userId is available.
 * Returns 429 with a Retry-After header when the limit is exceeded.
 */
function userUploadThrottle(req: Request, res: Response, next: NextFunction): void {
  const userId = req.session?.userId;
  if (!userId) {
    // No authenticated user – requireAuth already guards this; just pass through.
    return next();
  }

  const now = Date.now();
  const max = getMaxUploadsPerUser();

  // Prune timestamps outside the window to keep memory bounded.
  // Always write the pruned list back so stale entries don't accumulate.
  const timestamps = (userUploadTimestamps.get(userId) ?? []).filter(
    (t) => now - t < WINDOW_MS
  );
  userUploadTimestamps.set(userId, timestamps);

  if (timestamps.length >= max) {
    const oldestInWindow = timestamps[0];
    const retryAfterMs = WINDOW_MS - (now - oldestInWindow);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: `Upload rate limit exceeded. You may upload at most ${max} images per 15 minutes.`,
    });
    return;
  }

  timestamps.push(now);
  userUploadTimestamps.set(userId, timestamps);
  next();
}

/**
 * Limits the number of simultaneous in-flight upload requests from the same IP.
 * Returns 429 immediately when the cap is reached; the counter is decremented when
 * the response is finished (whether it succeeds or errors).
 */
function concurrentUploadGuard(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip;
  if (!ip) {
    res.status(400).json({ error: 'Unable to determine client IP address.' });
    return;
  }
  const max = getMaxConcurrentUploads();
  const current = concurrentUploads.get(ip) ?? 0;

  if (current >= max) {
    res.status(429).json({
      error: 'Too many concurrent uploads. Please wait for your current uploads to complete.',
    });
    return;
  }

  concurrentUploads.set(ip, current + 1);

  // Decrement the counter when the response completes, covering both a normal
  // finish and an early client disconnect (close fires without finish).
  let decremented = false;
  const decrement = () => {
    if (decremented) return;
    decremented = true;
    const count = concurrentUploads.get(ip) ?? 0;
    if (count <= 1) {
      concurrentUploads.delete(ip);
    } else {
      concurrentUploads.set(ip, count - 1);
    }
  };
  res.on('finish', decrement);
  res.on('close', decrement);

  next();
}

/**
 * Resets all in-memory throttle state. Intended for use in tests only.
 */
function _resetCountersForTesting(): void {
  userUploadTimestamps.clear();
  concurrentUploads.clear();
}

export { uploadLimiter, userUploadThrottle, concurrentUploadGuard, _resetCountersForTesting };
