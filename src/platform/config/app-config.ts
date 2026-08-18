import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from './env.schema';

/**
 * The only place environment variables are read. Everything else injects this.
 * `process.env` outside this file is a lint error — see AGENTS.md §9.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.get('PORT');
  }

  get apiPrefix(): string {
    return this.get('API_PREFIX');
  }

  get apiDefaultVersion(): string {
    return this.get('API_DEFAULT_VERSION');
  }

  get trustProxy(): boolean {
    return this.get('TRUST_PROXY');
  }

  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get database() {
    return {
      url:
        this.get('DATABASE_URL') ??
        `postgres://${this.get('POSTGRES_USER')}:${this.get('POSTGRES_PASSWORD')}` +
          `@${this.get('POSTGRES_HOST')}:${this.get('POSTGRES_PORT')}/${this.get('POSTGRES_DB')}`,
      host: this.get('POSTGRES_HOST'),
      port: this.get('POSTGRES_PORT'),
      user: this.get('POSTGRES_USER'),
      password: this.get('POSTGRES_PASSWORD'),
      name: this.get('POSTGRES_DB'),
    };
  }

  get redis() {
    return {
      url: this.get('REDIS_URL') ?? `redis://${this.get('REDIS_HOST')}:${this.get('REDIS_PORT')}`,
      host: this.get('REDIS_HOST'),
      port: this.get('REDIS_PORT'),
    };
  }

  get storage() {
    return {
      uploadMaxBytes: this.get('UPLOAD_MAX_BYTES'),
    };
  }

  get s3() {
    return {
      endpoint: this.get('S3_ENDPOINT'),
      region: this.get('S3_REGION'),
      bucket: this.get('S3_BUCKET'),
      accessKeyId: this.get('S3_ACCESS_KEY_ID'),
      secretAccessKey: this.get('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: this.get('S3_FORCE_PATH_STYLE'),
      presignExpirySeconds: this.get('S3_PRESIGN_EXPIRY_SECONDS'),
    };
  }

  get mail() {
    return {
      enabled: this.get('MAIL_ENABLED'),
      from: this.get('MAIL_FROM'),
    };
  }

  get notifications() {
    return {
      intervalMs: this.get('NOTIFICATION_DISPATCH_INTERVAL_MS'),
      batch: this.get('NOTIFICATION_DISPATCH_BATCH'),
      maxAttempts: this.get('NOTIFICATION_MAX_ATTEMPTS'),
    };
  }

  get scheduler() {
    return {
      enabled: this.get('SCHEDULER_ENABLED'),
      lockTtlMs: this.get('SCHEDULER_LOCK_TTL_MS'),
    };
  }

  get upstream() {
    return {
      timeoutMs: this.get('UPSTREAM_TIMEOUT_MS'),
      maxAttempts: this.get('UPSTREAM_MAX_ATTEMPTS'),
      retryBaseMs: this.get('UPSTREAM_RETRY_BASE_MS'),
      retryMaxMs: this.get('UPSTREAM_RETRY_MAX_MS'),
      breakerThreshold: this.get('UPSTREAM_BREAKER_THRESHOLD'),
      breakerResetMs: this.get('UPSTREAM_BREAKER_RESET_MS'),
    };
  }

  get bodyLimit(): string {
    return this.get('BODY_LIMIT');
  }

  get version(): string {
    return this.get('APP_VERSION');
  }

  get swagger() {
    return {
      enabled: this.get('SWAGGER_ENABLED') ?? !this.isProduction,
      path: this.get('SWAGGER_PATH'),
    };
  }

  get nats() {
    return {
      url: this.get('NATS_URL'),
      maxAgeMs: this.get('NATS_MAX_AGE_MS'),
    };
  }

  get outbox() {
    return {
      enabled: this.get('OUTBOX_ENABLED'),
      intervalMs: this.get('OUTBOX_INTERVAL_MS'),
      batchSize: this.get('OUTBOX_BATCH_SIZE'),
      maxAttempts: this.get('OUTBOX_MAX_ATTEMPTS'),
    };
  }

  get durableConsumer() {
    return {
      enabled: this.get('DURABLE_CONSUMER_ENABLED'),
      maxDeliver: this.get('DURABLE_MAX_DELIVER'),
      ackWaitMs: this.get('DURABLE_ACK_WAIT_MS'),
      nakDelayMs: this.get('DURABLE_NAK_DELAY_MS'),
    };
  }

  get rbac() {
    return {
      cacheTtlSeconds: this.get('RBAC_CACHE_TTL_SECONDS'),
    };
  }

  /** Read by `pnpm seed` only — never by the running application. */
  get seed() {
    return {
      superadminEmail: this.get('SEED_SUPERADMIN_EMAIL').trim(),
      superadminPassword: this.get('SEED_SUPERADMIN_PASSWORD'),
      allowRemote: this.get('ALLOW_REMOTE_SEED'),
    };
  }

  get logging() {
    return {
      level: this.get('LOG_LEVEL'),
      // Machine-readable where something is collecting it, readable where a
      // person is watching it.
      format: this.get('LOG_FORMAT') ?? (this.isProduction ? 'json' : 'pretty'),
    };
  }

  get metrics() {
    return {
      enabled: this.get('METRICS_ENABLED'),
    };
  }

  get rateLimit() {
    return {
      enabled: this.get('RATE_LIMIT_ENABLED'),
      limit: this.get('RATE_LIMIT_LIMIT'),
      windowSeconds: this.get('RATE_LIMIT_WINDOW_SECONDS'),
      authLimit: this.get('RATE_LIMIT_AUTH_LIMIT'),
      authWindowSeconds: this.get('RATE_LIMIT_AUTH_WINDOW_SECONDS'),
    };
  }

  get health() {
    return {
      timeoutMs: this.get('HEALTH_CHECK_TIMEOUT_MS'),
    };
  }

  get jwt() {
    return {
      privateKeyPath: this.get('JWT_PRIVATE_KEY_PATH'),
      publicKeyPath: this.get('JWT_PUBLIC_KEY_PATH'),
      accessTtlSeconds: this.get('JWT_ACCESS_TTL_SECONDS'),
      refreshTtlSeconds: this.get('JWT_REFRESH_TTL_SECONDS'),
    };
  }
}
