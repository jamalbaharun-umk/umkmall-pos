import { z } from 'zod';

// Config comes from the environment only, validated once at boot (fail fast on a bad deploy).
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  // The POS's OWN session secret. Never UMKMall's auth_token key (UMK-1924 settled decision).
  POS_SESSION_SECRET: z.string().min(32),
  // Local-disk image store (U2). Swap the ObjectStorage adapter for object storage in production.
  POS_STORAGE_DIR: z.string().min(1).default('.storage'),
  // UMKMall handoff (UMK-1924 U1): JWKS for the handoff token, API base for the liveness call, and the
  // shared service key that call sends. The POS holds no UMKMall signing key.
  UMKMALL_JWKS_URL: z.string().url(),
  UMKMALL_API_URL: z.string().url(),
  POS_SERVICE_KEY: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
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
