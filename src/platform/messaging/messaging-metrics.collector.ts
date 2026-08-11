import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { CollectedGauge, MetricsService } from '../observability/metrics.service';
import { MessagingMetricsService } from './messaging-metrics.service';

/**
 * Publishes the numbers behind `GET /api/v1/admin/messaging/status` as gauges,
 * so the same backlog an operator can curl is also alertable.
 *
 * The bridge lives in `messaging/` rather than in `observability/` to keep the
 * dependency one-way: messaging knows how to describe itself, observability
 * knows nothing about brokers. The reverse would make the metrics module
 * import half the platform.
 *
 * Values are read when Prometheus scrapes, not on a timer — one query per
 * scrape interval against numbers that are meaningless when stale.
 */
@Injectable()
export class MessagingMetricsCollector implements OnModuleInit {
  private readonly logger = new Logger(MessagingMetricsCollector.name);

  private readonly brokerReachable: CollectedGauge;
  private readonly streamMessages: CollectedGauge;
  private readonly outboxPending: CollectedGauge;
  private readonly outboxDeadLettered: CollectedGauge;
  private readonly outboxOldestAge: CollectedGauge;
  private readonly consumerPending: CollectedGauge;
  private readonly consumerAckPending: CollectedGauge;
  private readonly consumerRedelivered: CollectedGauge;
  private readonly consumerDeadLetters: CollectedGauge;
  private readonly consumerPresent: CollectedGauge;

  constructor(
    private readonly status: MessagingMetricsService,
    private readonly metrics: MetricsService,
  ) {
    const consumer = ['consumer'];

    this.brokerReachable = metrics.gauge(
      'messaging_broker_reachable',
      '1 when the NATS connection is established',
    );
    this.streamMessages = metrics.gauge(
      'messaging_stream_messages',
      'Messages currently held by the DOMAIN_EVENTS stream',
    );
    this.outboxPending = metrics.gauge(
      'outbox_pending_events',
      'Committed events not yet published to the broker',
    );
    this.outboxDeadLettered = metrics.gauge(
      'outbox_dead_lettered_events',
      'Events the relay gave up on after exhausting its attempts',
    );
    this.outboxOldestAge = metrics.gauge(
      'outbox_oldest_pending_age_seconds',
      'Age of the oldest unpublished event; the number to alert on',
    );
    this.consumerPending = metrics.gauge(
      'consumer_pending_messages',
      'Messages matched by a consumer that it has not received yet',
      consumer,
    );
    this.consumerAckPending = metrics.gauge(
      'consumer_ack_pending_messages',
      'Messages delivered to a consumer and not yet acked',
      consumer,
    );
    this.consumerRedelivered = metrics.gauge(
      'consumer_redelivered_messages',
      'Cumulative redeliveries; rising while pending holds means failures',
      consumer,
    );
    this.consumerDeadLetters = metrics.gauge(
      'consumer_dead_letters',
      'Rows in the dead-letter table for a consumer',
      consumer,
    );
    this.consumerPresent = metrics.gauge(
      'consumer_present',
      '0 when a declared handler has no consumer on the stream — it never started',
      consumer,
    );
  }

  onModuleInit(): void {
    this.metrics.beforeCollect(() => this.refresh());
  }

  private async refresh(): Promise<void> {
    try {
      const status = await this.status.status();

      this.brokerReachable.set(status.brokerReachable ? 1 : 0);
      this.streamMessages.set(status.stream?.messages ?? 0);
      this.outboxPending.set(status.outbox.pending);
      this.outboxDeadLettered.set(status.outbox.deadLettered);
      this.outboxOldestAge.set(status.outbox.oldestPendingAgeSeconds ?? 0);

      // Reset first: a consumer that disappears between scrapes must stop
      // reporting, not freeze at its last value and look healthy forever.
      this.consumerPending.reset();
      this.consumerAckPending.reset();
      this.consumerRedelivered.reset();
      this.consumerDeadLetters.reset();
      this.consumerPresent.reset();

      for (const lag of status.consumers) {
        const labels = { consumer: lag.name };

        this.consumerPending.set(lag.pending, labels);
        this.consumerAckPending.set(lag.ackPending, labels);
        this.consumerRedelivered.set(lag.redelivered, labels);
        this.consumerDeadLetters.set(lag.deadLetters, labels);
        this.consumerPresent.set(lag.present ? 1 : 0, labels);
      }
    } catch (error) {
      // The scrape still returns process and HTTP metrics. Losing the queue
      // depth because the database is down would hide the incident just as it
      // starts.
      this.logger.warn(
        `messaging metrics unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
