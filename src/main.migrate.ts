import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from './platform/database/data-source';
import { AppConfig, ConfigModule } from './platform/config';

/**
 * Applies pending migrations, then exits.
 *
 * Boots `ConfigModule` alone rather than `AppModule`, unlike every other entry
 * point here. Migrating is the one job that runs *before* the schema exists,
 * and the full application does not tolerate that: the outbox relay reads
 * `outbox.events` on its first tick and the consumer service reconciles against
 * `messaging.processed_events`, so a fresh database would produce a wall of
 * errors from a process whose only job is to create those tables.
 *
 * It also means this needs no `typeorm.config.ts` in the image — the options
 * come from `AppConfig`, the same way the running application builds them, so
 * the CLI's separate environment reads cannot drift from what the app uses.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(ConfigModule, {
    logger: ['error', 'warn'],
  });

  const config = app.get(AppConfig);
  const dataSource = new DataSource(
    buildDataSourceOptions({ url: config.database.url, logging: false }),
  );

  try {
    await dataSource.initialize();
    const applied = await dataSource.runMigrations();

    if (applied.length === 0) {
      console.log('migrations: already up to date');
      return;
    }

    console.log(`migrations: applied ${applied.length}`);

    for (const migration of applied) {
      console.log(`  + ${migration.name}`);
    }
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }

    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);

  // exit(), not just exitCode — see the note in main.seed.ts. A migration that
  // fails must fail the deploy step, not hang it.
  process.exit(1);
});
