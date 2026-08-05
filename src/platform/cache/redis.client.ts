import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfig } from '../config';

@Injectable()
export class RedisClient implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisClient.name);
  readonly connection: Redis;

  constructor(config: AppConfig) {
    this.connection = new Redis(config.redis.url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });

    this.connection.on('error', (error: Error) => {
      // Logged, not thrown: a Redis blip must surface in logs without taking
      // the process down. Callers decide how to degrade (see the blacklist).
      this.logger.error(`redis error: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection.quit();
  }
}
