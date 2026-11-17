import { randomBytes } from 'node:crypto';

// Test wiring for the local docker-compose Postgres (port 5544). CI provides ADMIN_DATABASE_URL.
// The pos_app role key and the session key are random per run, so nothing secret-looking is
// committed; global-setup writes them to process.env and the tests (runInBand) read them back.
function dbUrl(user: string, key: string): string {
  const u = new URL('postgres://placeholder/pos');
  u.host = process.env.PGTEST_HOST ?? 'localhost:5544';
  u.username = user;
  u.password = key;
  return u.toString();
}

process.env.PGTEST_APP_KEY ??= randomBytes(16).toString('hex');
process.env.POS_SESSION_SECRET ??= randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';

export const APP_ROLE_KEY = process.env.PGTEST_APP_KEY;
export const ADMIN_DATABASE_URL =
  process.env.ADMIN_DATABASE_URL ??
  dbUrl('pos', process.env.PGTEST_ADMIN_KEY ?? 'pos');
export const APP_DATABASE_URL = dbUrl('pos_app', APP_ROLE_KEY);

process.env.DATABASE_URL = APP_DATABASE_URL;
