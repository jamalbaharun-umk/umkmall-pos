import { z } from 'zod';

// Config comes from the environment only, validated once at boot (fail fast on a bad deploy).
// An empty value (`PAYMENT_API_URL=`) means unset.
const blankIsUnset = (v: unknown) => (v === '' ? undefined : v);
const flag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    // The POS's OWN session secret. Never UMKMall's auth_token key (UMK-1924 settled decision).
    POS_SESSION_SECRET: z.string().min(32),
    // Local-disk image store (U2). Swap the ObjectStorage adapter for object storage in production.
    POS_STORAGE_DIR: z.string().min(1).default('.storage'),
    // UMKMall's web origin: owner sign-in asks its `/api/auth/me` with the shared login cookie (UMK-1945).
    // The POS holds no UMKMall key or proxy secret.
    UMKMALL_WEB_URL: z.string().url(),
    // Shared with UMKMall: authenticates its call to POST /internal/tenants/purge (U8).
    POS_SERVICE_KEY: z.string().min(16),
    // payment-api (UMK-1991). Unset = off: sales complete in one step and nothing is sent. Set = every sale,
    // kasbon payment and void is recorded there, and PAYMENT_SERVICE_KEY (the same value as payment-api's) is required.
    PAYMENT_API_URL: z.preprocess(blankIsUnset, z.string().url().optional()),
    PAYMENT_SERVICE_KEY: z.preprocess(
      blankIsUnset,
      z.string().min(16).optional(),
    ),
    PAYMENT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    // In production the URL must be https, so the service key never travels in clear. A deploy whose two
    // services talk over a private network only may set this to allow http.
    PAYMENT_API_ALLOW_HTTP: flag,
    // A row payment-api keeps refusing is parked after this many refusals (GET /payment-sync/issues).
    POS_PAYMENT_SYNC_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    // The job that finishes what a request left behind: every this often (0 = no timer)…
    POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60),
    // …for sales that have awaited payment longer than this: time for the cashier to repeat the request.
    // Refused at boot below twice PAYMENT_API_TIMEOUT_MS.
    POS_PAYMENT_RECONCILE_AFTER_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(120),
    // How many proxies in front of pos-api set X-Forwarded-For truthfully (0 = none: the peer address is the
    // client). The per-address limits of device pairing count the address this yields, so it must be the
    // cashier device's, not a relay's.
    POS_TRUSTED_PROXIES: z.coerce.number().int().nonnegative().default(0),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
  })
  .refine((env) => !env.PAYMENT_API_URL || !!env.PAYMENT_SERVICE_KEY, {
    path: ['PAYMENT_SERVICE_KEY'],
  })
  .refine(
    (env) =>
      !env.PAYMENT_API_URL ||
      env.NODE_ENV !== 'production' ||
      env.PAYMENT_API_ALLOW_HTTP ||
      env.PAYMENT_API_URL.startsWith('https://'),
    { path: ['PAYMENT_API_URL'] },
  )
  .refine(
    (env) =>
      !env.PAYMENT_API_URL ||
      env.POS_PAYMENT_RECONCILE_AFTER_SECONDS * 1000 >=
        2 * env.PAYMENT_API_TIMEOUT_MS,
    { path: ['POS_PAYMENT_RECONCILE_AFTER_SECONDS'] },
  );

export type Env = z.infer<typeof EnvSchema> & {
  /**
   * UMK-1991: online payment methods exist only for the local fake gateway until the legal gate (UMK-1977).
   * True only where NODE_ENV is EXPLICITLY `development` or `test`: an unset NODE_ENV (read as development
   * everywhere else) and production both refuse them. Fails closed.
   */
  onlinePaymentsAllowed: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Name the variables, never print their values.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${names}`);
  }
  return {
    ...parsed.data,
    onlinePaymentsAllowed:
      source.NODE_ENV === 'development' || source.NODE_ENV === 'test',
  };
}
