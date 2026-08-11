import { INestApplication, VersioningType } from '@nestjs/common';

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

  // `health/ready` has to be listed too: `exclude` matches a path exactly, so
  // excluding `health` alone would leave the readiness probe under /api.
  app.setGlobalPrefix(config.apiPrefix, { exclude: ['health', 'health/ready', 'metrics'] });

  /**
   * URI versioning: `/api/v1/users`. The version is in the path because that
   * is where it is visible — in a log line, a curl from a bug report, a
   * dashboard label and the Swagger URL. A header carries the same
   * information where nobody looks, and makes "which version broke?" a
   * question you cannot answer from access logs.
   *
   * Probes and the metrics scrape opt out with `VERSION_NEUTRAL`; they are
   * configured once in a deployment manifest and outlive any API version.
   */
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.apiDefaultVersion,
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AppErrorFilter());
  app.enableShutdownHooks();

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }
}
