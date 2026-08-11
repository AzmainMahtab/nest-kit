import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * One line per completed request, carrying the correlation id through the
 * logger's async context.
 *
 * Without it a request that fails with a 4xx leaves no trace at all in the
 * logs — `AppErrorFilter` only logs internal errors — and "show me everything
 * this request did" has nothing to anchor to. `http_requests_total` counts the
 * same traffic, but a counter cannot tell you *which* request.
 *
 * Probes are skipped. A liveness check every five seconds is 17k lines a day
 * that say nothing; they are already visible as metrics, which is the right
 * shape for something that only matters in aggregate.
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    if (isProbe(request.path)) {
      next();
      return;
    }

    const start = process.hrtime.bigint();

    response.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const line = `${request.method} ${request.originalUrl} ${response.statusCode} ${ms.toFixed(1)}ms`;

      // 5xx is the only level that should page anyone; a 401 is the guard
      // doing its job, not an incident.
      if (response.statusCode >= 500) {
        this.logger.error(line);
      } else {
        this.logger.log(line);
      }
    });

    next();
  }
}

function isProbe(path: string): boolean {
  return path === '/health' || path === '/health/ready' || path === '/metrics';
}
