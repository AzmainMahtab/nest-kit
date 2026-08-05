import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OutboxStatsDto {
  @ApiProperty({ example: 0, description: 'Committed but not yet published' })
  pending!: number;

  @ApiProperty({ example: 0, description: 'Gave up after OUTBOX_MAX_ATTEMPTS' })
  deadLettered!: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  oldestPendingAt!: Date | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Matters more than the count: a steady backlog is fine, a stuck row is not',
  })
  oldestPendingAgeSeconds!: number | null;
}

export class StreamStateDto {
  @ApiProperty({ example: 'DOMAIN_EVENTS' }) name!: string;
  @ApiProperty({ example: 412 }) messages!: number;
  @ApiProperty({ example: 98304 }) bytes!: number;
}

export class ConsumerLagDto {
  @ApiProperty({ example: 'notification_welcome' }) name!: string;
  @ApiProperty({ type: [String], example: ['identity.user.registered'] }) subjects!: string[];

  @ApiProperty({ example: 0, description: 'Matched but not yet received' })
  pending!: number;

  @ApiProperty({ example: 0, description: 'Delivered, not yet acked — in flight or retrying' })
  ackPending!: number;

  @ApiProperty({ example: 0, description: 'Rising without pending falling means failures' })
  redelivered!: number;

  @ApiProperty({ example: 0 }) deadLetters!: number;

  @ApiProperty({
    example: true,
    description: 'False means the consumer failed to start — a fault, not an absence',
  })
  present!: boolean;
}

export class MessagingStatusDto {
  @ApiProperty({ example: true }) brokerReachable!: boolean;

  @ApiPropertyOptional({ type: StreamStateDto, nullable: true })
  stream!: StreamStateDto | null;

  @ApiProperty({ type: OutboxStatsDto }) outbox!: OutboxStatsDto;
  @ApiProperty({ type: [ConsumerLagDto] }) consumers!: ConsumerLagDto[];
}

export class OutboxDeadLetterDto {
  @ApiProperty({ example: '42' }) id!: string;
  @ApiProperty({ example: 'identity.user.registered' }) name!: string;
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: Date;
  @ApiProperty({ example: 5 }) attempts!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) lastError!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  deadLetteredAt!: Date | null;
}

export class ConsumerDeadLetterDto {
  @ApiProperty({ example: '7' }) id!: string;
  @ApiProperty({ example: 'notification_welcome' }) consumerName!: string;
  @ApiProperty({ example: 'identity.user.registered' }) eventName!: string;
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
  @ApiProperty({ example: 'Error: notification store unavailable' }) error!: string;
  @ApiProperty({ example: 5 }) deliveryCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class ReplayResultDto {
  @ApiProperty({ example: 3, description: 'Rows whose dead-letter state was cleared' })
  replayed!: number;

  @ApiProperty({ example: 3, description: 'Published by the drain performed in the same request' })
  drained!: number;
}
