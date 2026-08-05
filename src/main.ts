import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AppConfig } from './platform/config';
import { configureApp } from './platform/http/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);

  configureApp(app);

  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('nest-kit').setVersion('0.0.1').addBearerAuth().build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.port);
  new Logger('Bootstrap').log(`listening on :${config.port} (${config.nodeEnv})`);
}

void bootstrap();
