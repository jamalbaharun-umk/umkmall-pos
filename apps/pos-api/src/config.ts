import { z } from 'zod';

// Config comes from the environment only, validated once at boot (fail fast on a bad deploy).
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
    PAYMENT_API_URL: z.string().url().optional(),
    PAYMENT_SERVICE_KEY: z.string().min(16).optional(),
    PAYMENT_API_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    // The job that finishes what a request left behind: every this often (0 = no timer)…
    POS_PAYMENT_RECONCILE_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60),
    // …for sales that have awaited payment longer than this. Keep it far above PAYMENT_API_TIMEOUT_MS.
    POS_PAYMENT_RECONCILE_AFTER_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(120),
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
  })
  .refine((env) => !env.PAYMENT_API_URL || !!env.PAYMENT_SERVICE_KEY, {
    path: ['PAYMENT_SERVICE_KEY'],
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Name the variables, never print their values.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${names}`);
  }
  return parsed.data;
}
