import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AppConfig } from './platform/config';
import { configureApp } from './platform/http/configure-app';
import { setupSwagger } from './platform/http/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);

  configureApp(app);
  setupSwagger(app, config);

  await app.listen(config.port);
  new Logger('Bootstrap').log(`listening on :${config.port} (${config.nodeEnv})`);
}

void bootstrap();
