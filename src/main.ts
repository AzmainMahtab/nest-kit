import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AppConfig } from './platform/config';
import { AppErrorFilter } from './platform/http/filters/app-error.filter';
import { ResponseEnvelopeInterceptor } from './platform/http/interceptors/response-envelope.interceptor';
import { createValidationPipe } from './platform/http/pipes/validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AppErrorFilter());
  app.enableShutdownHooks();

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

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
