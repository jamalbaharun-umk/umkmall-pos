import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate';
import { ADMIN_DATABASE_URL, APP_DATABASE_URL, APP_ROLE_KEY } from './env';

const OPS = path.join(__dirname, '..', '..', '..', '..', 'ops');

// Fresh `pos` schema per run, built exactly as production is: stub users table (local only),
// the owner-run role script, then migrations as pos_app.
export default async function globalSetup() {
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
  await runMigrations(APP_DATABASE_URL);
}
