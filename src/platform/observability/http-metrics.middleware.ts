import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { MetricsService } from './metrics.service';

/**
 * Counts and times every response, including the ones no controller saw.
 *
 * This is middleware rather than an interceptor on purpose: an interceptor
 * only runs for a matched route, so 404s, payload-too-large and anything
 * rejected by a guard before the handler would be missing from
 * `http_requests_total` — which is exactly the traffic you go looking for
 * when something is wrong.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    response.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.httpRequest(request.method, routeOf(request), response.statusCode, seconds);
    });

    next();
  }
}

/**
 * The matched route *pattern*, e.g. `/api/v1/users/:uuid`.
 *
 * Never the URL. `/api/v1/users/019fd1…` as a label is one time series per
 * user, which is how a Prometheus instance dies. Unmatched requests collapse
 * into a single `unmatched` series for the same reason — a 404 scan would
 * otherwise mint a series per probed path.
 */
interface MatchedRoute {
  path?: string;
}

function routeOf(request: Request): string {
  // Express types `route` as `any`, and it is only populated once a layer has
  // matched — so both the type and the presence have to be checked here.
  const route = (request as unknown as { route?: MatchedRoute }).route;

  if (typeof route?.path !== 'string') {
    return 'unmatched';
  }

  return `${request.baseUrl}${route.path}` || '/';
}
