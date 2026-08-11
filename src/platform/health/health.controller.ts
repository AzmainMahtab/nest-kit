import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiEnvelope } from '../http/swagger';
import { HealthResponseDto, ReadinessResponseDto } from './health.dto';
import { HealthService, ReadinessReport } from './health.service';

import { NoRateLimit } from '../http/decorators/rate-limit.decorator';
import { Public } from '../http/decorators/public.decorator';

/**
 * Unversioned on purpose: a probe is configured once in a deployment manifest
 * and must not break when the API moves to v2.
 */
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @NoRateLimit()
  @Get()
  @ApiOperation({ summary: 'Liveness probe; public and outside the API prefix' })
  @ApiEnvelope(HealthResponseDto, { status: 200 })
  check(): HealthResponseDto {
    return { status: 'ok' };
  }

  /**
   * Liveness answers "is the event loop turning?" — restarting on a failure is
   * the right response. Readiness answers "can this instance serve?" — the
   * right response is to stop sending it traffic, not to kill it. Wiring one
   * probe to both is how a Postgres blip becomes a cluster-wide restart loop.
   */
  @Public()
  @NoRateLimit()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe; 503 when a required dependency is down',
  })
  @ApiEnvelope(ReadinessResponseDto, { status: 200, description: 'ready or degraded' })
  @ApiEnvelope(ReadinessResponseDto, { status: 503, description: 'not_ready' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const report = await this.health.readiness();

    if (report.status === 'not_ready') {
      response.status(503);
    }

    return report;
  }
}
