import { Injectable } from '@nestjs/common';
import { z } from 'zod';

// "false"/"0"/"off" turn a flag off; z.coerce.boolean() would read the string "false" as true.
const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'on', 'off'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1' || v === 'on');
const count = (fallback: number) =>
  z.coerce.number().int().nonnegative().default(fallback);

/** Adapters a deploy can add to the CASHAC ones by naming them in PAYMENT_ADAPTERS. */
export const OPTIONAL_ADAPTERS = ['fake'] as const;
export type OptionalAdapter = (typeof OPTIONAL_ADAPTERS)[number];
const names = (list: string | undefined) =>
  (list ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
/**
 * Is the adapter named in PAYMENT_ADAPTERS? Read where a module is defined, before `loadEnv` has run; the
 * list itself is validated by `loadEnv` at boot.
 */
export const adapterListed = (
  name: OptionalAdapter,
  source: NodeJS.ProcessEnv = process.env,
): boolean => names(source.PAYMENT_ADAPTERS).includes(name);

// Config comes from the environment only, validated once at boot (fail fast on a bad deploy).
const EnvSchema = z
  .object({
    // The payment_app role in the payment database (ops/payment-role.sql). Never the POS database.
    DATABASE_URL: z.string().url(),
    // Shared with every calling service: authenticates each request (header X-Payment-Service-Key).
    PAYMENT_SERVICE_KEY: z.string().min(16),
    PORT: z.coerce.number().int().positive().default(3001),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    // Values of the payment flow (design doc "Payment-api: alur pembayaran PG dan kasus tepi"). All are
    // configuration, so an owner decision changes a deploy variable and no code.
    // Money that matches no payment (late, duplicate, wrong amount) is refunded automatically by `system`
    // (owner decision); off = it waits, flagged needs_review, for the owner.
    PAYMENT_LATE_AUTO_REFUND: flag(true),
    // The owner may mark a refund the PG refused as "returned by hand" (owner decision).
    PAYMENT_MANUAL_REFUND_MARK: flag(true),
    // How long a QR or VA accepts payment (owner decision: 15 minutes).
    PAYMENT_QR_TTL_SECONDS: count(900),
    // After the bill's expiry, how long a payment on its way is still waited for before the AUTOMATIC `expired`
    // (a proposal, not yet an owner decision). A cashier's own cancel never waits for it.
    PAYMENT_EXPIRY_GRACE_SECONDS: count(600),
    // A closed online payment (cancelled, expired, failed) is still asked about at the PG until this long after
    // its bill's expiry, so late money whose webhook was lost is found and refunded.
    PAYMENT_LATE_SWEEP_SECONDS: count(3600),
    // When the PG cannot close an unpaid QR, the cashier may still cancel and switch to cash; later money on
    // that QR is refunded automatically (owner decision, D13). Off = cancel is refused until the QR expires.
    PAYMENT_CANCEL_WITHOUT_GATEWAY_CLOSE: flag(true),
    // A manual status check asks the PG at most once per this interval per payment (PG rate limits).
    PAYMENT_SYNC_MIN_INTERVAL_SECONDS: count(5),
    // The reconciliation asks the PG about payments still in flight after this long…
    PAYMENT_RECONCILE_AFTER_SECONDS: count(120),
    // …every this often. 0 = no timer (tests, or a deploy that runs it elsewhere).
    PAYMENT_RECONCILE_INTERVAL_SECONDS: count(60),
    // A `created` payment is failed only after two "no such bill" answers at least this far apart.
    PAYMENT_NOT_FOUND_CONFIRM_SECONDS: count(60),
    // A webhook event that keeps failing is parked after this many attempts.
    PAYMENT_WEBHOOK_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    // A refused refund blocks the tenant purge for this many days, then no longer (owner decision, M19).
    PAYMENT_PURGE_FAILED_REFUND_BLOCK_DAYS: count(30),
    // Extra adapters, comma separated. Only `fake`: the local fake gateway (src/adapters/fake), which adds the
    // methods fake_qris and fake_va and the control routes under /dev/fake-gateway. Never in production.
    PAYMENT_ADAPTERS: z
      .string()
      .default('')
      .transform(names)
      .pipe(z.array(z.enum(OPTIONAL_ADAPTERS))),
  })
  // The fake gateway lets anyone with the service key mark a bill paid: it must not exist in production.
  .refine(
    (env) =>
      !(env.NODE_ENV === 'production' && env.PAYMENT_ADAPTERS.includes('fake')),
    { path: ['PAYMENT_ADAPTERS'] },
  )
  // A bill becomes `expired` only at its expiry plus the grace. A sweep that ended before that would never
  // look at an expired bill for late money.
  .refine(
    (env) => env.PAYMENT_LATE_SWEEP_SECONDS >= env.PAYMENT_EXPIRY_GRACE_SECONDS,
    { path: ['PAYMENT_LATE_SWEEP_SECONDS'] },
  );

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Name the variables, never print their values.
    const invalid = [
      ...new Set(parsed.error.issues.map((i) => String(i.path[0]))),
    ].join(', ');
    throw new Error(`Invalid environment: ${invalid}`);
  }
  return parsed.data;
}

/** The payment-flow settings, read once from the environment. One injectable so nothing hard-codes them. */
@Injectable()
export class PaymentSettings {
  lateAutoRefund: boolean;
  manualRefundMark: boolean;
  qrTtlMs: number;
  expiryGraceMs: number;
  lateSweepMs: number;
  cancelWithoutGatewayClose: boolean;
  syncMinIntervalMs: number;
  reconcileAfterMs: number;
  reconcileIntervalMs: number;
  notFoundConfirmMs: number;
  webhookMaxAttempts: number;
  purgeFailedRefundBlockMs: number;

  constructor() {
    const env = loadEnv();
    this.lateAutoRefund = env.PAYMENT_LATE_AUTO_REFUND;
    this.manualRefundMark = env.PAYMENT_MANUAL_REFUND_MARK;
    this.qrTtlMs = env.PAYMENT_QR_TTL_SECONDS * 1000;
    this.expiryGraceMs = env.PAYMENT_EXPIRY_GRACE_SECONDS * 1000;
    this.lateSweepMs = env.PAYMENT_LATE_SWEEP_SECONDS * 1000;
    this.cancelWithoutGatewayClose = env.PAYMENT_CANCEL_WITHOUT_GATEWAY_CLOSE;
    this.syncMinIntervalMs = env.PAYMENT_SYNC_MIN_INTERVAL_SECONDS * 1000;
    this.reconcileAfterMs = env.PAYMENT_RECONCILE_AFTER_SECONDS * 1000;
    this.reconcileIntervalMs = env.PAYMENT_RECONCILE_INTERVAL_SECONDS * 1000;
    this.notFoundConfirmMs = env.PAYMENT_NOT_FOUND_CONFIRM_SECONDS * 1000;
    this.webhookMaxAttempts = env.PAYMENT_WEBHOOK_MAX_ATTEMPTS;
    this.purgeFailedRefundBlockMs =
      env.PAYMENT_PURGE_FAILED_REFUND_BLOCK_DAYS * 86_400_000;
  }
}

/** The service's clock. One injectable so expiry and reconciliation can be tested without waiting. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
