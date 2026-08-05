import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiEnvelope } from '../http/swagger';
import { HealthResponseDto } from './health.dto';

import { Public } from '../http/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe; public and outside the API prefix' })
  @ApiEnvelope(HealthResponseDto, { status: 200 })
  check(): HealthResponseDto {
    return { status: 'ok' };
  }
}
