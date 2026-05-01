const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
// Per-user upload sliding window: userId → timestamps of uploads within the window
const userUploadTimestamps = new Map();
// Concurrent upload tracking: ip → number of in-flight upload requests
const concurrentUploads = new Map();
function getMaxUploadsPerUser() {
    const val = parseInt(process.env.USER_UPLOAD_RATE_LIMIT_MAX ?? '', 10);
    if (!isNaN(val) && val > 0)
        return val;
    // Default to a permissive limit in test mode so normal test suites are unaffected.
    return process.env.NODE_ENV === 'test' ? 10000 : 20;
}
function getMaxConcurrentUploads() {
    const val = parseInt(process.env.MAX_CONCURRENT_UPLOADS ?? '', 10);
    if (!isNaN(val) && val > 0)
        return val;
    return process.env.NODE_ENV === 'test' ? 1000 : 3;
}
/**
 * Sliding-window per-user upload rate limiter.
 * Must be placed after session/auth middleware so req.session.userId is available.
 * Returns 429 with a Retry-After header when the limit is exceeded.
 */
function userUploadThrottle(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) {
        // No authenticated user – requireAuth already guards this; just pass through.
        return next();
    }
    const now = Date.now();
    const max = getMaxUploadsPerUser();
    // Prune timestamps outside the window to keep memory bounded.
    const timestamps = (userUploadTimestamps.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
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
function concurrentUploadGuard(req, res, next) {
    const ip = req.ip ?? 'unknown';
    const max = getMaxConcurrentUploads();
    const current = concurrentUploads.get(ip) ?? 0;
    if (current >= max) {
        res.status(429).json({
            error: 'Too many concurrent uploads. Please wait for your current uploads to complete.',
        });
        return;
    }
    concurrentUploads.set(ip, current + 1);
    res.on('finish', () => {
        const count = concurrentUploads.get(ip) ?? 1;
        if (count <= 1) {
            concurrentUploads.delete(ip);
        }
        else {
            concurrentUploads.set(ip, count - 1);
        }
    });
    next();
}
/**
 * Resets all in-memory throttle state. Intended for use in tests only.
 */
function _resetCountersForTesting() {
    userUploadTimestamps.clear();
    concurrentUploads.clear();
}
export { userUploadThrottle, concurrentUploadGuard, _resetCountersForTesting };
//# sourceMappingURL=uploadThrottle.js.map