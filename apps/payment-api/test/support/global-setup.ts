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

// Fresh `payment` schema per run in this session's database, built exactly as production is: the
// owner-run role script, then migrations as payment_app.
export default async function globalSetup() {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(TEST_DB)) {
    throw new Error('PAYTEST_DB must be a lower-case identifier');
  }
  // The POS databases (`pos`, `pos_*`) belong to pos-api and its sessions.
  if (TEST_DB.startsWith('pos') || TEST_DB === 'postgres') {
    throw new Error('PAYTEST_DB must not be a POS or system database');
  }
  // Parallel sessions share one cluster and the role is cluster-wide: an advisory lock in the maintenance
  // database serializes role setup across sessions ("tuple concurrently updated" otherwise).
  const maintenance = postgres(MAINTENANCE_DATABASE_URL, { max: 1 });
  try {
    await maintenance`select pg_advisory_lock(hashtext('umkmall-payment-test-setup'))`;
    const [exists] =
      await maintenance`select 1 from pg_database where datname = ${TEST_DB}`;
    if (!exists) await maintenance.unsafe(`create database ${TEST_DB}`);

    const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe('DROP SCHEMA IF EXISTS payment CASCADE');
      await admin.unsafe(
        readFileSync(path.join(OPS, 'payment-role.sql'), 'utf8'),
      );
      await admin.unsafe(`ALTER ROLE payment_app PASSWORD '${APP_ROLE_KEY}'`);
    } finally {
      await admin.end();
    }
  } finally {
    await maintenance.end(); // ending the connection releases the advisory lock
  }
  await runMigrations(APP_DATABASE_URL);
}
