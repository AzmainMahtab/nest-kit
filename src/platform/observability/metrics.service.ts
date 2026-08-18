import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** A gauge whose value is only known at scrape time. */
export interface CollectedGauge {
  set(value: number, labels?: Record<string, string>): void;
  reset(): void;
}

/**
 * The metrics registry, and the only file that imports `prom-client`.
 *
 * Everything else records through the typed methods below, so the exposition
 * library is swappable and — more importantly — the metric names and label
 * sets live in one place. A counter named at its call site drifts: two
 * spellings of the same thing become two series, and the dashboard silently
 * shows half the traffic.
 *
 * Labels are deliberately low cardinality. `route` is the matched *pattern*,
 * never `request.url` — one series per user id is how a Prometheus instance
 * runs out of memory.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly refreshers: Array<() => Promise<void> | void> = [];

  private readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  private readonly eventsPublished = new Counter({
    name: 'events_published_total',
    help: 'Domain events published to the broker by the outbox relay',
    labelNames: ['event_type'] as const,
    registers: [this.registry],
  });

  private readonly eventsConsumed = new Counter({
    name: 'events_consumed_total',
    help: 'Domain events consumed by a durable handler',
    labelNames: ['event_type', 'outcome'] as const,
    registers: [this.registry],
  });

  private readonly eventsDeadLettered = new Counter({
    name: 'events_dlq_total',
    help: 'Events routed to the dead-letter table after exhausting redelivery',
    labelNames: ['event_type'] as const,
    registers: [this.registry],
  });

  private readonly handlerDuration = new Histogram({
    name: 'event_handler_duration_seconds',
    help: 'Time a durable handler spent on one event',
    labelNames: ['event_type'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 30],
    registers: [this.registry],
  });

  private readonly upstreamRequests = new Counter({
    name: 'upstream_requests_total',
    help: 'Calls made to an upstream dependency, by host and outcome',
    labelNames: ['host', 'outcome'] as const,
    registers: [this.registry],
  });

  private readonly upstreamDuration = new Histogram({
    name: 'upstream_request_duration_seconds',
    help: 'Wall time of an upstream call, including retries',
    labelNames: ['host'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 30],
    registers: [this.registry],
  });

  private readonly rateLimitRejections = new Counter({
    name: 'rate_limit_rejected_total',
    help: 'Requests rejected by the rate limiter',
    labelNames: ['scope'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  rateLimited(scope: string): void {
    this.rateLimitRejections.inc({ scope });
  }

  httpRequest(method: string, route: string, statusCode: number, seconds: number): void {
    this.httpRequests.inc({ method, route, status_code: String(statusCode) });
    this.httpDuration.observe({ method, route }, seconds);
  }

  /** `host`, never a URL — a path carries ids, and a label may never be unbounded. */
  upstreamRequest(host: string, outcome: string, seconds: number): void {
    this.upstreamRequests.inc({ host, outcome });
    this.upstreamDuration.observe({ host }, seconds);
  }

  eventPublished(eventType: string): void {
    this.eventsPublished.inc({ event_type: eventType });
  }

  eventConsumed(eventType: string, outcome: 'ok' | 'failed' | 'duplicate'): void {
    this.eventsConsumed.inc({ event_type: eventType, outcome });
  }

  eventDeadLettered(eventType: string): void {
    this.eventsDeadLettered.inc({ event_type: eventType });
  }

  eventHandled(eventType: string, seconds: number): void {
    this.handlerDuration.observe({ event_type: eventType }, seconds);
  }

  /**
   * A gauge for state that lives somewhere else — outbox depth, consumer lag.
   * Pair it with `beforeCollect` so the value is read when Prometheus asks,
   * not on a timer nobody tuned.
   */
  gauge(name: string, help: string, labelNames: string[] = []): CollectedGauge {
    const gauge = new Gauge({ name, help, labelNames, registers: [this.registry] });

    return {
      set: (value, labels) => (labels ? gauge.set(labels, value) : gauge.set(value)),
      reset: () => gauge.reset(),
    };
  }

  /** Runs on every scrape, before the registry is rendered. */
  beforeCollect(refresh: () => Promise<void> | void): void {
    this.refreshers.push(refresh);
  }

  async render(): Promise<{ contentType: string; body: string }> {
    // A refresher that throws must not blank the whole scrape — the process
    // metrics are still worth having when NATS is the thing that is down.
    await Promise.allSettled(this.refreshers.map(async (refresh) => refresh()));

    return {
      contentType: this.registry.contentType,
      body: await this.registry.metrics(),
    };
  }
}
