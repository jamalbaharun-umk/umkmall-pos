import { createHash, randomBytes } from 'node:crypto';

// Test wiring for the local docker-compose Postgres (port 5544); CI points PGTEST_HOST at its service.
// payment-api has its OWN database: PAYTEST_DB (global-setup creates it), never the POS's. Each parallel
// session sets its own name. The payment_app role is cluster-wide, so its local test key is derived (the same
// for every session) rather than random.
const DB = process.env.PAYTEST_DB ?? 'payment_test';

function dbUrl(user: string, key: string, database: string): string {
  const u = new URL('postgres://placeholder/');
  u.host = process.env.PGTEST_HOST ?? 'localhost:5544';
  u.username = user;
  u.password = key;
  u.pathname = `/${database}`;
  return u.toString();
}

process.env.PAYTEST_APP_KEY ??= createHash('sha256')
  .update('umkmall payment-api local test role')
  .digest('hex');
process.env.NODE_ENV = 'test';
process.env.PAYMENT_SERVICE_KEY ??= randomBytes(16).toString('hex');
// No timer in tests: each test calls the reconciliation tick itself, on a fake clock.
process.env.PAYMENT_RECONCILE_INTERVAL_SECONDS = '0';

const ADMIN_KEY = process.env.PGTEST_ADMIN_KEY ?? 'pos';
export const TEST_DB = DB;
export const APP_ROLE_KEY = process.env.PAYTEST_APP_KEY;
/** The cluster's always-present `postgres` database, used only to create the test database. */
export const MAINTENANCE_DATABASE_URL = dbUrl('pos', ADMIN_KEY, 'postgres');
export const ADMIN_DATABASE_URL = dbUrl('pos', ADMIN_KEY, DB);
export const APP_DATABASE_URL = dbUrl('payment_app', APP_ROLE_KEY, DB);

process.env.DATABASE_URL = APP_DATABASE_URL;
