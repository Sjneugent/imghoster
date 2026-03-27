/**
 * Lightweight logger for ImgHoster.
 *
 * Provides timestamped, level-tagged log messages without any external
 * dependencies.  In production the output can be piped to a log aggregator;
 * in tests noisy levels can be silenced via LOG_LEVEL.
 *
 * Levels (lowest → highest): debug, info, warn, error
 */

const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = LEVELS[process.env.LOG_LEVEL ?? ''] ?? LEVELS.info;

function format(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

const logger = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.debug) console.debug(format('debug', msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.info) console.info(format('info', msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.warn) console.warn(format('warn', msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LEVELS.error) console.error(format('error', msg, meta));
  },
};

export default logger;
