import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

export class DependencyCheckDto {
  @ApiProperty({ example: 'postgres' })
  name!: string;

  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  status!: string;

  @ApiProperty({
    example: true,
    description: 'False for a dependency the API can serve traffic without.',
  })
  required!: boolean;

  @ApiProperty({ example: 3 })
  latencyMs!: number;

  @ApiProperty({ required: false, example: 'connect ECONNREFUSED 127.0.0.1:5432' })
  error?: string;
}

export class ReadinessResponseDto {
  @ApiProperty({
    example: 'ready',
    enum: ['ready', 'degraded', 'not_ready'],
    description: '`degraded` still serves traffic; `not_ready` returns 503.',
  })
  status!: string;

  @ApiProperty({ type: [DependencyCheckDto] })
  checks!: DependencyCheckDto[];
}
