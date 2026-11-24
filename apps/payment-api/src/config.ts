import { z } from 'zod';

// Config comes from the environment only, validated once at boot (fail fast on a bad deploy).
const EnvSchema = z.object({
  // The payment_app role in the payment database (ops/payment-role.sql). Never the POS database.
  DATABASE_URL: z.string().url(),
  // Shared with every calling service: authenticates each request (header X-Payment-Service-Key).
  PAYMENT_SERVICE_KEY: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(3001),
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
