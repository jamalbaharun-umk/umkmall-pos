import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate';
import {
  ADMIN_DATABASE_URL,
  APP_DATABASE_URL,
  APP_ROLE_KEY,
  MAINTENANCE_DATABASE_URL,
  TEST_DB,
} from './env';

const OPS = path.join(__dirname, '..', '..', '..', '..', 'ops');

// Fresh `pos` schema per run in this session's database, built exactly as production is: stub users
// table (local only), the owner-run role script, then migrations as pos_app.
export default async function globalSetup() {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(TEST_DB)) {
    throw new Error('PGTEST_DB must be a lower-case identifier');
  }
  // Parallel sessions share one cluster: the role is cluster-wide, so concurrent ALTER ROLE / GRANT
  // fail with "tuple concurrently updated". An advisory lock in the shared maintenance database
  // serializes setup across sessions; each session's own schema work then runs alone.
  const maintenance = postgres(MAINTENANCE_DATABASE_URL, { max: 1 });
  try {
    await maintenance`select pg_advisory_lock(hashtext('umkmall-pos-test-setup'))`;
    const [exists] =
      await maintenance`select 1 from pg_database where datname = ${TEST_DB}`;
    if (!exists) await maintenance.unsafe(`create database ${TEST_DB}`);

    const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe('DROP SCHEMA IF EXISTS pos CASCADE');
      await admin.unsafe(
        readFileSync(path.join(OPS, 'local-public-users.sql'), 'utf8'),
      );
      await admin.unsafe(readFileSync(path.join(OPS, 'pos-role.sql'), 'utf8'));
      await admin.unsafe(`ALTER ROLE pos_app PASSWORD '${APP_ROLE_KEY}'`);
    } finally {
      await admin.end();
    }
  } finally {
    await maintenance.end(); // ending the connection releases the advisory lock
  }
  await runMigrations(APP_DATABASE_URL);
}
