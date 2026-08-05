import { join } from 'node:path';

import { DataSourceOptions } from 'typeorm';

export interface DatabaseOptions {
  url: string;
  logging?: boolean;
}

/**
 * Single definition of the connection, shared by the Nest provider and the
 * TypeORM CLI (typeorm.config.ts). Keeping one builder is what stops the
 * runtime schema and the migration schema from drifting apart.
 *
 * The globs resolve relative to this file, so they point at src/*.ts under
 * ts-node and dist/*.js after a build without needing two configurations.
 * `user.orm-entity.d.ts` does not match `*.orm-entity.{ts,js}`.
 */
export function buildDataSourceOptions(options: DatabaseOptions): DataSourceOptions {
  return {
    type: 'postgres',
    url: options.url,
    // Never true, in any environment including test. Schema changes go through
    // migrations only — see AGENTS.md §10.
    synchronize: false,
    logging: options.logging ?? false,
    entities: [join(__dirname, '..', '..', 'modules', '**', '*.orm-entity.{ts,js}')],
    migrations: [join(__dirname, '..', '..', 'database', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'migrations',
  };
}
