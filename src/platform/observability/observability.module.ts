import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { RequestLogMiddleware } from './request-log.middleware';

/**
 * Global because a metric recorded from one module and a correlation id read
 * in another have to be the same instance — two registries would each hold
 * half the numbers.
 *
 * The middleware is applied here rather than in `configureApp` so that e2e
 * tests, which build the module graph themselves, get the same request
 * context and the same counters as production.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Correlation first: the other two run inside its async context, so the
    // request log line carries the id.
    // `{*splat}` rather than `*`: Express 5 requires wildcards to be named.
    consumer
      .apply(CorrelationIdMiddleware, RequestLogMiddleware, HttpMetricsMiddleware)
      .forRoutes('{*splat}');
  }
}
