import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from './src/platform/database/data-source';

// CLI entry point only — the running application builds its options from
// AppConfig. This file lives outside src/ deliberately: it is tooling, and the
// architecture check forbids reading process.env inside the application.
try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; fall back to the ambient environment.
}

const host = process.env.POSTGRES_HOST ?? 'localhost';
const port = process.env.POSTGRES_PORT ?? '5432';
const user = process.env.POSTGRES_USER ?? 'app';
const password = process.env.POSTGRES_PASSWORD ?? 'app';
const database = process.env.POSTGRES_DB ?? 'appdb';

export default new DataSource(
  buildDataSourceOptions({
    url: process.env.DATABASE_URL ?? `postgres://${user}:${password}@${host}:${port}/${database}`,
    logging: true,
  }),
);
