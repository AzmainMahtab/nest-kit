import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders the Prometheus exposition format', async () => {
    const metrics = new MetricsService();
    metrics.httpRequest('GET', '/api/v1/users', 200, 0.012);

    const { contentType, body } = await metrics.render();

    expect(contentType).toContain('text/plain');
    expect(body).toContain(
      'http_requests_total{method="GET",route="/api/v1/users",status_code="200"} 1',
    );
    expect(body).toContain('http_request_duration_seconds_bucket');
  });

  it('includes process metrics without anyone recording them', async () => {
    const { body } = await new MetricsService().render();

    expect(body).toContain('process_cpu_seconds_total');
    expect(body).toContain('nodejs_eventloop_lag_seconds');
  });

  it('reads deferred values at scrape time', async () => {
    const metrics = new MetricsService();
    const pending = metrics.gauge('outbox_pending_events', 'Pending');
    let depth = 0;

    metrics.beforeCollect(() => {
      pending.set(++depth);
    });

    await metrics.render();
    const { body } = await metrics.render();

    // Second scrape, second read — not a value frozen at start-up.
    expect(body).toContain('outbox_pending_events 2');
  });

  it('still returns a scrape when a refresher throws', async () => {
    const metrics = new MetricsService();
    metrics.beforeCollect(() => {
      throw new Error('database down');
    });

    // Losing the process and HTTP metrics because the database is down would
    // hide the incident exactly as it starts.
    const { body } = await metrics.render();
    expect(body).toContain('process_cpu_seconds_total');
  });

  it('clears labelled series so a departed consumer stops reporting', async () => {
    const metrics = new MetricsService();
    const lag = metrics.gauge('consumer_pending_messages', 'Lag', ['consumer']);

    lag.set(5, { consumer: 'gone' });
    expect((await metrics.render()).body).toContain('consumer="gone"');

    lag.reset();
    expect((await metrics.render()).body).not.toContain('consumer="gone"');
  });

  it('counts rate-limit rejections by scope', async () => {
    const metrics = new MetricsService();
    metrics.rateLimited('auth');

    expect((await metrics.render()).body).toContain('rate_limit_rejected_total{scope="auth"} 1');
  });
});
