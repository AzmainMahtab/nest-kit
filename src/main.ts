import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AppConfig } from './platform/config';
import { configureApp } from './platform/http/configure-app';
import { setupSwagger } from './platform/http/swagger';
import { StructuredLogger } from './platform/observability';

async function bootstrap(): Promise<void> {
  // Buffered until the logger is installed: the alternative is a handful of
  // start-up lines in Nest's default format and the rest in JSON, which is
  // exactly the mixed stream a collector cannot parse.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfig);

  app.useLogger(new StructuredLogger(config.logging.level, config.logging.format));

  configureApp(app);
  setupSwagger(app, config);

  await app.listen(config.port);
  new Logger('Bootstrap').log(
    `listening on :${config.port} (${config.nodeEnv}), api at /${config.apiPrefix}/v${config.apiDefaultVersion}`,
  );
}

void bootstrap();
