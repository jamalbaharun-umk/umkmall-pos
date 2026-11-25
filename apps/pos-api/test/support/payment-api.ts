import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo, Server } from 'node:net';
import path from 'node:path';
import postgres from 'postgres';
import { Clock } from '../../../payment-api/src/config';
import { runMigrations as runPaymentMigrations } from '../../../payment-api/src/db/migrate';

// The REAL payment-api (apps/payment-api's Nest app), in this process, on its own database, for the pos-api
// integration tests (UMK-1991). The database is `<PAYTEST_DB or payment_test>_pos`: never the one
// payment-api's own suite uses, so the two suites can run at the same time, and never a POS database.
const DB = `${process.env.PAYTEST_DB ?? 'payment_test'}_pos`;
const OPS = path.join(__dirname, '..', '..', '..', '..', 'ops');
const ADMIN_KEY = process.env.PGTEST_ADMIN_KEY ?? 'pos';
// The payment_app role is cluster-wide: the same derived local key as payment-api's own test setup.
const APP_KEY =
  process.env.PAYTEST_APP_KEY ??
  createHash('sha256')
    .update('umkmall payment-api local test role')
    .digest('hex');

function dbUrl(user: string, key: string, database: string): string {
  const u = new URL('postgres://placeholder/');
  u.host = process.env.PGTEST_HOST ?? 'localhost:5544';
  u.username = user;
  u.password = key;
  u.pathname = `/${database}`;
  return u.toString();
}

export const PAYMENT_ADMIN_DATABASE_URL = dbUrl('pos', ADMIN_KEY, DB);
const PAYMENT_APP_DATABASE_URL = dbUrl('payment_app', APP_KEY, DB);

/** A fresh `payment` schema, built as production is: the owner-run role script, then migrations as payment_app. */
async function setupPaymentDatabase() {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(DB) || DB.startsWith('pos'))
    throw new Error('PAYTEST_DB must be a lower-case, non-POS identifier');
  const maintenance = postgres(dbUrl('pos', ADMIN_KEY, 'postgres'), { max: 1 });
  try {
    // The same lock as payment-api's global setup: role changes are cluster-wide.
    await maintenance`select pg_advisory_lock(hashtext('umkmall-payment-test-setup'))`;
    const [exists] =
      await maintenance`select 1 from pg_database where datname = ${DB}`;
    if (!exists) await maintenance.unsafe(`create database ${DB}`);
    const admin = postgres(PAYMENT_ADMIN_DATABASE_URL, {
      max: 1,
      onnotice: () => {},
    });
    try {
      await admin.unsafe('DROP SCHEMA IF EXISTS payment CASCADE');
      await admin.unsafe(
        readFileSync(path.join(OPS, 'payment-role.sql'), 'utf8'),
      );
      await admin.unsafe(`ALTER ROLE payment_app PASSWORD '${APP_KEY}'`);
    } finally {
      await admin.end();
    }
  } finally {
    await maintenance.end();
  }
  await runPaymentMigrations(PAYMENT_APP_DATABASE_URL);
}

/** payment-api's clock, moved by a test: a bill expires, or the grace period after it ends, without waiting. */
export class TestClock extends Clock {
  private offset = 0;
  now(): Date {
    return new Date(Date.now() + this.offset);
  }
  advance(ms: number) {
    this.offset += ms;
  }
}

export interface PaymentApi {
  url: string;
  serviceKey: string;
  clock: TestClock;
  /** Direct SQL on the payment database as its owner, for assertions only. */
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Starts payment-api on a free local port. Both apps read `DATABASE_URL` from the environment when they are
 * built, so it points at the payment database only while payment-api is being built, and is put back after.
 */
export async function startPaymentApi(
  options: { fakeGateway?: boolean } = {},
): Promise<PaymentApi> {
  await setupPaymentDatabase();
  const serviceKey = randomBytes(16).toString('hex');
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    PAYMENT_SERVICE_KEY: process.env.PAYMENT_SERVICE_KEY,
    PAYMENT_RECONCILE_INTERVAL_SECONDS:
      process.env.PAYMENT_RECONCILE_INTERVAL_SECONDS,
    PAYMENT_ADAPTERS: process.env.PAYMENT_ADAPTERS,
  };
  const clock = new TestClock();
  let app: INestApplication;
  try {
    process.env.DATABASE_URL = PAYMENT_APP_DATABASE_URL;
    process.env.PAYMENT_SERVICE_KEY = serviceKey;
    process.env.PAYMENT_RECONCILE_INTERVAL_SECONDS = '0';
    // The local fake gateway (methods fake_qris and fake_va, controls under /dev/fake-gateway). payment-api
    // decides whether to mount it when its AppModule is first loaded, so that happens only here, after the
    // variable is set. Jest gives each test file its own module registry.
    // A test file that imported `payment-fake-env.ts` first has set it already.
    if (options.fakeGateway) process.env.PAYMENT_ADAPTERS = 'fake';
    const { AppModule: PaymentAppModule } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../payment-api/src/app.module') as typeof import('../../../payment-api/src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentAppModule],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.listen(0, '127.0.0.1');
  } finally {
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
  const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
  const sql = postgres(PAYMENT_ADMIN_DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  // Connects now: the driver learns the array types on connect, and `seedMerchant` sends a text[] first.
  await sql`select 1`;
  return {
    url: `http://127.0.0.1:${port}`,
    serviceKey,
    clock,
    sql,
    close: async () => {
      await app.close();
      await sql.end();
    },
  };
}
