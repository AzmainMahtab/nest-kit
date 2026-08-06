import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { RbacSeeder, SuperAdminSeeder, assertSeedAllowed } from './database/seeds';
import { UserRepository } from './modules/identity';
import { RbacRepository } from './modules/rbac';
import { AppConfig } from './platform/config';
import { Clock, EventBus, Hasher, UnitOfWork } from './shared/application';

/**
 * Reconciles a database to the seed catalogue and provisions the first
 * administrator.
 *
 * Boots the real AppModule rather than a hand-assembled subset, for the same
 * reason `export-openapi.ts` does: anything less drifts from the application,
 * and a seed that writes through different wiring than production is a seed
 * that can produce rows production would not.
 *
 * Safe to re-run. Every step is idempotent and additive — nothing here revokes
 * a permission, resets a password or removes a role.
 *
 *   make seed                              # host
 *   docker compose run --rm api seed       # in the stack
 *
 * The caller is expected to set `OUTBOX_ENABLED=false` and
 * `DURABLE_CONSUMER_ENABLED=false` — the Makefile target and
 * `docker-entrypoint.sh` both do. They are not set here because reading or
 * writing the environment outside `platform/config` fails the architecture
 * gate, and the rule is worth more than the convenience: an entry point that
 * quietly rewrites its own configuration is exactly what that gate catches.
 *
 * Nothing breaks if they are missed. The relay claims outbox rows with
 * `FOR UPDATE SKIP LOCKED` precisely so several can run at once, so a seed that
 * also relays is wasteful rather than wrong.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const config = app.get(AppConfig);
    assertSeedAllowed({ host: config.database.host, allowRemote: config.seed.allowRemote });

    // The seeders are plain classes, constructed here rather than registered as
    // providers. Nothing in the running application can reach them, which is
    // the point — this writes data.
    const catalogue = new RbacSeeder(
      app.get(RbacRepository),
      app.get(EventBus),
      app.get(UnitOfWork),
      app.get(Clock),
    );

    const report = await catalogue.run();
    console.log(
      `rbac: ${describe(report.permissionsCreated, 'permission')}, ` +
        `${describe(report.rolesCreated, 'role')}, ` +
        `${report.permissionsGranted.length} grant(s) added`,
    );

    for (const grant of report.permissionsGranted) {
      console.log(`  + ${grant}`);
    }

    const { superadminEmail, superadminPassword } = config.seed;

    if (!superadminEmail || !superadminPassword) {
      console.log(
        'superadmin: skipped — set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD to provision one',
      );
      return;
    }

    const superadmin = new SuperAdminSeeder(
      app.get(UserRepository),
      app.get(RbacRepository),
      app.get(Hasher),
      app.get(EventBus),
      app.get(UnitOfWork),
      app.get(Clock),
    );

    const result = await superadmin.run(superadminEmail, superadminPassword);

    // The address, never the password — this output ends up in CI logs.
    console.log(
      `superadmin: ${superadminEmail} ` +
        `(${result.userCreated ? 'created' : 'already existed'}, ` +
        `admin role ${result.roleAssigned ? 'assigned' : 'already held'})`,
    );
  } finally {
    await settleInProcessHandlers();
    await app.close();
  }
}

/**
 * In-process `@EventsHandler`s are dispatched after the commit but are *not*
 * awaited by `@nestjs/cqrs` — `publish` hands the event to a subject and
 * returns. Closing immediately therefore destroys the connection pool while the
 * grant invalidator is still resolving a role to its holders, which surfaced as
 * a `Connection terminated` error printed after a seed that had already
 * succeeded.
 *
 * A fixed pause rather than a real barrier, because the bus exposes no hook to
 * await. That is acceptable precisely here: the writes are already committed,
 * and the only work being waited on is a cache eviction whose failure mode is
 * bounded by `RBAC_CACHE_TTL_SECONDS`.
 */
function settleInProcessHandlers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

function describe(created: string[], noun: string): string {
  return created.length === 0
    ? `no new ${noun}s`
    : `${created.length} ${noun}(s) created [${created.join(', ')}]`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);

  // exit(), not just exitCode. A failure inside createApplicationContext leaves
  // whatever providers did initialise — the pool, the Redis client — holding
  // open handles, and with nothing to close them the process hangs instead of
  // failing. A one-shot command that never returns is worse than one that
  // errors: it wedges the pipeline step waiting on it.
  process.exit(1);
});
