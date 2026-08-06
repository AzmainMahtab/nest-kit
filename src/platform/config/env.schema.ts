import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api'),
  CORS_ORIGINS: z.string().default(''),

  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().default('app'),
  POSTGRES_PASSWORD: z.string().default('app'),
  POSTGRES_DB: z.string().default('appdb'),
  DATABASE_URL: z.string().optional(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_URL: z.string().optional(),

  // Surfaced in the OpenAPI document. Set from the image tag when deploying.
  APP_VERSION: z.string().default('0.0.1'),

  // Defaults to on outside production; set explicitly to expose or hide it.
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  SWAGGER_PATH: z.string().default('docs'),

  NATS_URL: z.string().default('nats://localhost:4222'),
  NATS_MAX_AGE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60 * 1000),

  OUTBOX_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  DURABLE_CONSUMER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DURABLE_MAX_DELIVER: z.coerce.number().int().positive().default(5),
  DURABLE_ACK_WAIT_MS: z.coerce.number().int().positive().default(30000),
  DURABLE_NAK_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),

  // Bounds how long a revoked role can still authorize a request if the
  // invalidation on assign/revoke is lost — keep it short.
  RBAC_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // Read by `pnpm seed` only; the running application never touches them.
  // Both empty skips the superadmin seed and leaves the catalogue seed alone.
  SEED_SUPERADMIN_EMAIL: z.string().default(''),
  // Same floor as RegisterUserDto. A seeded administrator is the most valuable
  // account in the system and must not be the one exempt from the rule.
  SEED_SUPERADMIN_PASSWORD: z.string().min(12).or(z.literal('')).default(''),
  ALLOW_REMOTE_SEED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  JWT_PRIVATE_KEY_PATH: z.string().default('certs/private.pem'),
  JWT_PUBLIC_KEY_PATH: z.string().default('certs/public.pem'),
  // Seconds, not a duration string: the tokenizer needs a number, and parsing
  // "15m" at the edge is one more place to get it wrong.
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }

  return result.data;
}
