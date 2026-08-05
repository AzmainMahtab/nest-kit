import { INestApplication } from '@nestjs/common';

import { AppConfig } from '../config';
import { AppErrorFilter } from './filters/app-error.filter';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor';
import { createValidationPipe } from './pipes/validation';

/**
 * The single definition of the HTTP surface, used by `main.ts` and by every
 * e2e test.
 *
 * It exists because the tests previously repeated this wiring and drifted: one
 * suite omitted the error filter, so a domain error surfaced as 500 there and
 * 409 in production, and the test was asserting against an application that
 * did not match the deployed one.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AppErrorFilter());
  app.enableShutdownHooks();

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }
}
