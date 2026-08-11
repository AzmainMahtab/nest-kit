import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AppError } from '../../shared/errors';
import { AppConfig } from '../config';
import { Public } from '../http/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * The Prometheus scrape endpoint.
 *
 * Public and unversioned for the same reason as `/health`: a scraper has no
 * bearer token and does not follow an API's deprecation cycle. It is also not
 * enveloped — the exposition format is a fixed text contract, and wrapping it
 * in `{ success, data }` would make it unparseable by every Prometheus.
 *
 * It exposes internal timing and queue depth, so bind it to an internal
 * network or keep it behind the reverse proxy; `METRICS_ENABLED=false` turns
 * it off entirely.
 */
@ApiTags('Observability')
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Prometheus metrics; public, unversioned and not enveloped',
  })
  @ApiResponse({
    status: 200,
    description: 'Prometheus text exposition format',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  async scrape(@Res() response: Response): Promise<void> {
    if (!this.config.metrics.enabled) {
      throw AppError.notFound('METRICS_DISABLED', 'metrics are not enabled');
    }

    const { contentType, body } = await this.metrics.render();

    response.setHeader('content-type', contentType);
    response.send(body);
  }
}
