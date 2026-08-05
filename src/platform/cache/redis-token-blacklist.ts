import { Injectable } from '@nestjs/common';

import { TokenBlacklist } from '../../shared/application';
import { RedisClient } from './redis.client';

const PREFIX = 'revoked:jti:';

@Injectable()
export class RedisTokenBlacklist extends TokenBlacklist {
  constructor(private readonly redis: RedisClient) {
    super();
  }

  async revoke(jti: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);

    // An already-expired token needs no entry — it fails signature validation
    // on its own, and storing it would grow the set without bound.
    if (ttlSeconds <= 0) {
      return;
    }

    await this.redis.connection.set(`${PREFIX}${jti}`, '1', 'EX', ttlSeconds);
  }

  async isRevoked(jti: string): Promise<boolean> {
    return (await this.redis.connection.exists(`${PREFIX}${jti}`)) === 1;
  }
}
