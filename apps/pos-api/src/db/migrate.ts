import { readMigrationFiles } from 'drizzle-orm/migrator';
import path from 'node:path';
import postgres from 'postgres';

// Runs as the `pos_app` role (ops/pos-role.sql). drizzle's own migrator always issues
// `CREATE SCHEMA IF NOT EXISTS`, which needs CREATE on the whole database; pos_app only owns the
// `pos` schema, so this applies drizzle-kit's files itself, with drizzle's journal format, in `pos`.
const JOURNAL = 'pos.__drizzle_migrations';

export async function runMigrations(databaseUrl: string): Promise<number> {
  const migrations = readMigrationFiles({
    migrationsFolder: path.join(__dirname, '..', '..', 'drizzle'),
  });
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      `create table if not exists ${JOURNAL} (id serial primary key, hash text not null, created_at bigint)`,
    );
    const [last] = await sql.unsafe<{ created_at: string }[]>(
      `select created_at from ${JOURNAL} order by created_at desc limit 1`,
    );
    const pending = migrations.filter(
      (m) => !last || m.folderMillis > Number(last.created_at),
    );
    for (const m of pending) {
      await sql.begin(async (tx) => {
        for (const statement of m.sql) await tx.unsafe(statement);
        await tx.unsafe(
          `insert into ${JOURNAL} (hash, created_at) values ($1, $2)`,
          [m.hash, m.folderMillis],
        );
      });
    }
    return pending.length;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  runMigrations(url).then(
    (n) => process.stdout.write(`pos migrations applied: ${n}\n`),
    (error: unknown) => {
      process.stderr.write(`pos migrations failed: ${String(error)}\n`);
      process.exit(1);
    },
  );
}
