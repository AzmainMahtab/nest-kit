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

  get jwt() {
    return {
      privateKeyPath: this.get('JWT_PRIVATE_KEY_PATH'),
      publicKeyPath: this.get('JWT_PUBLIC_KEY_PATH'),
      accessTtlSeconds: this.get('JWT_ACCESS_TTL_SECONDS'),
      refreshTtlSeconds: this.get('JWT_REFRESH_TTL_SECONDS'),
    };
  }
}
