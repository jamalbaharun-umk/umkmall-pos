import { z } from 'zod';

// Config comes from the environment only, validated once at boot (fail fast on a bad deploy).
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  // The POS's OWN session secret. Never UMKMall's auth_token key (UMK-1924 settled decision).
  POS_SESSION_SECRET: z.string().min(32),
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
