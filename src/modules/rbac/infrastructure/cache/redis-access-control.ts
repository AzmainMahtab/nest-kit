import { Injectable, Logger } from '@nestjs/common';

import { AppConfig } from '../../../../platform/config';
import { RedisClient } from '../../../../platform/cache/redis.client';
import { AccessControl, Grants } from '../../../../shared/application';
import { RbacRepository } from '../../domain/ports/rbac-repository.port';

const PREFIX = 'rbac:grants:';

/**
 * Cache-aside over the repository. The guard runs on every authorized request,
 * and resolving roles → permissions through three tables each time would put a
 * join on the critical path of the whole API.
 *
 * Correctness does not depend on the cache: a miss, a decode failure or a Redis
 * outage all fall through to the database, which is authoritative. What the
 * cache costs is freshness, and that is bounded twice — by explicit
 * invalidation when grants change, and by `RBAC_CACHE_TTL_SECONDS` for the case
 * where the invalidation is lost (the process dies between the commit and the
 * in-process dispatch).
 */
@Injectable()
export class RedisAccessControl extends AccessControl {
  private readonly logger = new Logger(RedisAccessControl.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisClient,
    private readonly rbac: RbacRepository,
    config: AppConfig,
  ) {
    super();
    this.ttlSeconds = config.rbac.cacheTtlSeconds;
  }

  async grantsFor(userUuid: string): Promise<Grants> {
    const cached = await this.read(userUuid);

    if (cached) {
      return cached;
    }

    const grants = await this.rbac.grantsFor(userUuid);
    await this.write(userUuid, grants);

    return grants;
  }

  /**
   * Best effort by design. A failure here leaves a stale entry that expires on
   * its own within the TTL, so it is logged loudly rather than thrown: this runs
   * from an event handler, after the grant change has already committed, and
   * throwing would not undo it.
   */
  async invalidate(userUuids: readonly string[]): Promise<void> {
    if (userUuids.length === 0) {
      return;
    }

    try {
      await this.redis.connection.del(...userUuids.map((uuid) => `${PREFIX}${uuid}`));
    } catch (error) {
      this.logger.error(
        `failed to invalidate cached grants for ${userUuids.length} user(s); ` +
          `they remain authorized by the stale entry for up to ${this.ttlSeconds}s: ${asMessage(error)}`,
      );
    }
  }

  private async read(userUuid: string): Promise<Grants | null> {
    try {
      const raw = await this.redis.connection.get(`${PREFIX}${userUuid}`);

      return raw === null ? null : (JSON.parse(raw) as Grants);
    } catch (error) {
      // Includes a malformed entry written by an older shape of this type.
      // Treating it as a miss re-reads the database and overwrites it.
      this.logger.warn(
        `cached grants unreadable, falling back to the database: ${asMessage(error)}`,
      );
      return null;
    }
  }

  private async write(userUuid: string, grants: Grants): Promise<void> {
    try {
      await this.redis.connection.set(
        `${PREFIX}${userUuid}`,
        JSON.stringify(grants),
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(`failed to cache grants: ${asMessage(error)}`);
    }
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
