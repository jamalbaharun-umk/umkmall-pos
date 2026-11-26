import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Test wiring for the local docker-compose Postgres (port 5544); CI points PGTEST_HOST at its service.
// PGTEST_DB gives each parallel session its own database (global-setup creates it), so one session's
// fresh `pos` schema never wipes another's. The pos_app role is cluster-wide, so its local test key is
// derived (same for every session) rather than random; the session key is random per run.
const DB = process.env.PGTEST_DB ?? 'pos';

function dbUrl(user: string, key: string, database: string): string {
  const u = new URL('postgres://placeholder/');
  u.host = process.env.PGTEST_HOST ?? 'localhost:5544';
  u.username = user;
  u.password = key;
  u.pathname = `/${database}`;
  return u.toString();
}

process.env.PGTEST_APP_KEY ??= createHash('sha256')
  .update('umkmall-pos local test role')
  .digest('hex');
process.env.POS_SESSION_SECRET ??= randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
process.env.POS_STORAGE_DIR ??= mkdtempSync(
  path.join(tmpdir(), 'pos-storage-'),
);
// Placeholder so AppModule boots; test/auth.e2e-spec.ts points it at its fake UMKMall `/api/auth/me`.
process.env.UMKMALL_WEB_URL ??= 'http://127.0.0.1:9';
process.env.POS_SERVICE_KEY ??= randomBytes(16).toString('hex');
process.env.POS_AGENT_SERVICE_KEY ??= randomBytes(32).toString('hex');

const ADMIN_KEY = process.env.PGTEST_ADMIN_KEY ?? 'pos';
export const TEST_DB = DB;
export const APP_ROLE_KEY = process.env.PGTEST_APP_KEY;
/** The always-present `pos` database, used only to create the per-session test database. */
export const MAINTENANCE_DATABASE_URL = dbUrl('pos', ADMIN_KEY, 'pos');
export const ADMIN_DATABASE_URL = dbUrl('pos', ADMIN_KEY, DB);
export const APP_DATABASE_URL = dbUrl('pos_app', APP_ROLE_KEY, DB);

process.env.DATABASE_URL = APP_DATABASE_URL;
