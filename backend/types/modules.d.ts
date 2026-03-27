// Sibling .d.ts files are used for JS module declarations.
// See: db/index.d.ts, logger.d.ts

declare module 'express-session-better-sqlite3' {
  import type session from 'express-session';
  import type Database from 'better-sqlite3';

  function SqliteSessionStore(
    expressSession: typeof session,
    db: Database.Database
  ): new () => session.Store;

  export default SqliteSessionStore;
}
