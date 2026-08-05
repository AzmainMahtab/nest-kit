import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { OutboxRelay } from '../outbox/outbox.relay';
import { OutboxRepository } from '../outbox/outbox.repository';
import { DeadLetterRepository } from './dead-letter.repository';
import { DiscardDeadLetterDto, ReplayOutboxDto } from './dto/messaging-admin.dto';
import { MessagingMetricsService, MessagingStatus } from './messaging-metrics.service';

/**
 * Operational surface for the event pipeline: how far behind it is, what got
 * stuck, and how to push it through.
 *
 * ⚠️ Authenticated but not yet authorised. Until RBAC lands, any logged-in user
 * can replay and discard events. Restrict it with `@Roles('admin')` the moment
 * roles exist, or keep the route off the public ingress.
 */
@ApiTags('Messaging admin')
@ApiBearerAuth()
@Controller('admin/messaging')
export class MessagingAdminController {
  constructor(
    private readonly metrics: MessagingMetricsService,
    private readonly outbox: OutboxRepository,
    private readonly deadLetters: DeadLetterRepository,
    private readonly relay: OutboxRelay,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Outbox backlog, stream state and per-consumer lag' })
  status(): Promise<MessagingStatus> {
    return this.metrics.status();
  }

  @Get('outbox/dead-lettered')
  @ApiOperation({ summary: 'Outbox rows that exhausted their publish attempts' })
  async outboxDeadLettered(@Query('limit') limit?: string) {
    const rows = await this.outbox.listDeadLettered(boundedLimit(limit));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      idempotencyKey: row.idempotency_key,
      occurredAt: row.occurred_at,
      attempts: row.attempts,
      lastError: row.last_error ?? null,
      deadLetteredAt: row.dead_lettered_at ?? null,
    }));
  }

  @Post('outbox/replay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the dead-letter state so the relay retries' })
  @ApiResponse({ status: 200, description: '{ replayed, drained }' })
  async replayOutbox(@Body() dto: ReplayOutboxDto): Promise<{ replayed: number; drained: number }> {
    const replayed = await this.outbox.replayDeadLettered(dto.ids ?? []);
    // Drain immediately rather than leaving the operator to wait for the next
    // tick and wonder whether the replay did anything.
    const drained = await this.relay.tick();

    return { replayed, drained };
  }

  @Get('dead-letters')
  @ApiOperation({ summary: 'Messages a consumer could not process' })
  async consumerDeadLetters(@Query('limit') limit?: string) {
    const rows = await this.deadLetters.list(boundedLimit(limit));

    return rows.map((row) => ({
      id: row.id,
      consumerName: row.consumer_name,
      eventName: row.event_name,
      idempotencyKey: row.idempotency_key,
      error: row.error,
      deliveryCount: row.delivery_count,
      createdAt: row.created_at,
    }));
  }

  @Post('dead-letters/discard')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Drop a dead letter and its processed marker so a redelivery is handled afresh',
  })
  async discard(@Body() dto: DiscardDeadLetterDto): Promise<void> {
    await this.deadLetters.discard(dto.consumerName, dto.idempotencyKey);
  }
}

function boundedLimit(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
}
