import BaseStorageProvider from '../BaseStorageProvider.js';
import logger from '../../logger.js';
const CANARY_KEY = '__health_check_canary__';
const CANARY_DATA = Buffer.from('ok');
/**
 * ReplicatedProvider – fans out writes to N providers and falls back through
 * them in priority order for reads.  Provides HA / cluster scenarios.
 *
 * Write semantics: each write is attempted on all healthy providers in parallel.
 * A write succeeds if at least `writeQuorum` providers accept it.  Failed
 * providers are marked `degraded` and retried on next health-check cycle.
 *
 * Read semantics: providers are tried in order (first = primary).  If the
 * primary returns an error the next healthy provider is tried, and so on.
 * Returns 503-equivalent error only when ALL providers fail.
 *
 * Config env vars (when used via StorageProviderFactory):
 *   STORAGE_PROVIDERS                 – comma-separated provider names, e.g. "s3,local"
 *   STORAGE_WRITE_QUORUM              – min providers that must succeed (default: 1)
 *   STORAGE_HEALTH_CHECK_INTERVAL_MS  – polling interval in ms (default: 30000)
 */
class ReplicatedProvider extends BaseStorageProvider {
    name = 'replicated';
    states = [];
    writeQuorum = 1;
    healthCheckIntervalMs = 30_000;
    healthCheckTimer = null;
    async init(config) {
        const providers = config.providers;
        if (!Array.isArray(providers) || providers.length === 0) {
            throw new Error('ReplicatedProvider: "providers" array is required and must not be empty.');
        }
        this.states = providers.map(p => ({
            provider: p,
            health: 'healthy',
            lastCheckAt: 0,
            consecutiveFailures: 0,
        }));
        this.writeQuorum = Number(config.writeQuorum || process.env.STORAGE_WRITE_QUORUM || 1);
        this.healthCheckIntervalMs = Number(config.healthCheckIntervalMs || process.env.STORAGE_HEALTH_CHECK_INTERVAL_MS || 30_000);
        this.startHealthChecks();
        return this;
    }
    startHealthChecks() {
        if (this.healthCheckIntervalMs <= 0)
            return;
        this.healthCheckTimer = setInterval(() => {
            void this.runHealthChecks();
        }, this.healthCheckIntervalMs);
        // Don't block process exit
        if (this.healthCheckTimer.unref)
            this.healthCheckTimer.unref();
    }
    async runHealthChecks() {
        await Promise.allSettled(this.states.map(s => this.checkProvider(s)));
    }
    async checkProvider(state) {
        try {
            // Write canary then delete to verify both put and delete paths
            await state.provider.put(CANARY_KEY, CANARY_DATA, 'text/plain');
            await state.provider.delete(CANARY_KEY);
            state.health = 'healthy';
            state.consecutiveFailures = 0;
        }
        catch (err) {
            state.consecutiveFailures += 1;
            state.health = state.consecutiveFailures >= 3 ? 'offline' : 'degraded';
            logger.warn('Storage provider health check failed', {
                provider: state.provider.name,
                failures: state.consecutiveFailures,
                health: state.health,
                error: err.message,
            });
        }
        state.lastCheckAt = Date.now();
    }
    healthyProviders() {
        return this.states.filter(s => s.health !== 'offline');
    }
    async put(key, data, contentType) {
        const targets = this.healthyProviders();
        if (targets.length === 0) {
            throw new Error('ReplicatedProvider: all providers are offline.');
        }
        const results = await Promise.allSettled(targets.map(s => s.provider.put(key, data, contentType)));
        let succeeded = 0;
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                succeeded++;
                targets[i].consecutiveFailures = 0;
                targets[i].health = 'healthy';
            }
            else {
                targets[i].consecutiveFailures++;
                targets[i].health = 'degraded';
                logger.warn('Storage provider put failed', {
                    provider: targets[i].provider.name,
                    key,
                    error: result.reason?.message,
                });
            }
        }
        if (succeeded < this.writeQuorum) {
            throw new Error(`ReplicatedProvider: write quorum not met (${succeeded}/${this.writeQuorum} providers succeeded).`);
        }
    }
    async get(key) {
        const errors = [];
        for (const state of this.states) {
            if (state.health === 'offline')
                continue;
            try {
                return await state.provider.get(key);
            }
            catch (err) {
                errors.push(`${state.provider.name}: ${err.message}`);
                logger.warn('Storage provider get failed, trying fallback', {
                    provider: state.provider.name,
                    key,
                    error: err.message,
                });
            }
        }
        throw new Error(`ReplicatedProvider: all providers failed to get "${key}". Errors: ${errors.join('; ')}`);
    }
    async delete(key) {
        const targets = this.healthyProviders();
        await Promise.allSettled(targets.map(s => s.provider.delete(key)));
    }
    async exists(key) {
        for (const state of this.states) {
            if (state.health === 'offline')
                continue;
            try {
                return await state.provider.exists(key);
            }
            catch {
                // try next provider
            }
        }
        return false;
    }
    async stat(key) {
        for (const state of this.states) {
            if (state.health === 'offline')
                continue;
            try {
                const result = await state.provider.stat(key);
                if (result !== null)
                    return result;
            }
            catch {
                // try next
            }
        }
        return null;
    }
    async *list(prefix) {
        // Deduplicate keys across providers
        const seen = new Set();
        for (const state of this.states) {
            if (state.health === 'offline')
                continue;
            try {
                for await (const key of state.provider.list(prefix)) {
                    if (!seen.has(key)) {
                        seen.add(key);
                        yield key;
                    }
                }
                return; // use primary provider's listing
            }
            catch {
                // fall through to next provider
            }
        }
    }
    /** Returns the health status of each underlying provider (for monitoring). */
    getHealthStatus() {
        return this.states.map(s => ({
            name: s.provider.name,
            health: s.health,
            consecutiveFailures: s.consecutiveFailures,
        }));
    }
    async close() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        await Promise.allSettled(this.states.map(s => s.provider.close()));
    }
}
export default ReplicatedProvider;
//# sourceMappingURL=ReplicatedProvider.js.map