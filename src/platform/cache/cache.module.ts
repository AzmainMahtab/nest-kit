import { Global, Module } from '@nestjs/common';

import { TokenBlacklist } from '../../shared/application';
import { RedisClient } from './redis.client';
import { RedisTokenBlacklist } from './redis-token-blacklist';

@Global()
@Module({
  providers: [RedisClient, { provide: TokenBlacklist, useClass: RedisTokenBlacklist }],
  exports: [RedisClient, TokenBlacklist],
})
export class CacheModule {}
