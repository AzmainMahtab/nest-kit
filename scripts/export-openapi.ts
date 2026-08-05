import { writeFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { AppConfig } from '../src/platform/config';
import { configureApp } from '../src/platform/http/configure-app';
import { buildOpenApiDocument } from '../src/platform/http/swagger';

/**
 * Writes the spec without serving it, so a client can be generated in CI and
 * the diff reviewed on a pull request. Booting the real AppModule is the point:
 * a spec built from anything less would drift from the running application.
 */
async function main(): Promise<void> {
  const target = process.argv[2] ?? 'openapi.json';

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApp(app);

  const document = buildOpenApiDocument(app, app.get(AppConfig));
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);

  await app.close();

  const paths = Object.keys(document.paths).length;
  const schemas = Object.keys(document.components?.schemas ?? {}).length;
  console.log(`wrote ${target}: ${paths} paths, ${schemas} schemas`);
}

void main();
