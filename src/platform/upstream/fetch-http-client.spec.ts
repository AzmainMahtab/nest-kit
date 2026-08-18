import { Clock } from '../../shared/application';
import { AppConfig } from '../config';
import { MetricsService } from '../observability/metrics.service';
import { FetchHttpClient, FetchLike } from './fetch-http-client';

describe('FetchHttpClient', () => {
  let now: number;
  let metrics: { upstreamRequest: jest.Mock };

  const clock: Clock = { now: () => new Date(now) };

  const configWith = (overrides: Partial<AppConfig['upstream']> = {}): AppConfig =>
    ({
      upstream: {
        timeoutMs: 50,
        maxAttempts: 3,
        // Zero base and cap: the retry logic is under test, not setTimeout.
        retryBaseMs: 0,
        retryMaxMs: 0,
        breakerThreshold: 2,
        breakerResetMs: 1000,
        ...overrides,
      },
    }) as AppConfig;

  const clientWith = (fetchImpl: FetchLike, config = configWith()): FetchHttpClient =>
    new FetchHttpClient(config, clock, metrics as unknown as MetricsService, fetchImpl);

  const responding = (...statuses: number[]): jest.Mock => {
    const queue = [...statuses];
    return jest.fn(() => Promise.resolve(new Response('body', { status: queue.shift() ?? 200 })));
  };

  beforeEach(() => {
    now = 0;
    metrics = { upstreamRequest: jest.fn() };
  });

  it('returns the response and records it as ok', async () => {
    const fetchImpl = responding(200);

    const response = await clientWith(fetchImpl).send({ method: 'GET', url: 'https://api.test/x' });

    expect(response).toMatchObject({ status: 200, body: 'body' });
    expect(metrics.upstreamRequest).toHaveBeenCalledWith('api.test', 'ok', expect.any(Number));
  });

  it('returns a 404 rather than throwing — a not-found is often the answer', async () => {
    const response = await clientWith(responding(404)).send({
      method: 'GET',
      url: 'https://api.test/x',
    });

    expect(response.status).toBe(404);
    expect(metrics.upstreamRequest).toHaveBeenCalledWith(
      'api.test',
      'client_error',
      expect.any(Number),
    );
  });

  it('retries a 5xx on a GET and returns the eventual success', async () => {
    const fetchImpl = responding(503, 200);

    const response = await clientWith(fetchImpl).send({ method: 'GET', url: 'https://api.test/x' });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a POST, because one charge must not become two', async () => {
    const fetchImpl = responding(503, 200);

    const response = await clientWith(fetchImpl).send({
      method: 'POST',
      url: 'https://api.test/charge',
    });

    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a POST that declares itself idempotent', async () => {
    const fetchImpl = responding(503, 200);

    const response = await clientWith(fetchImpl).send({
      method: 'POST',
      url: 'https://api.test/charge',
      idempotent: true,
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and returns the last 5xx', async () => {
    const fetchImpl = responding(500, 500, 500);

    const response = await clientWith(fetchImpl).send({ method: 'GET', url: 'https://api.test/x' });

    expect(response.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(metrics.upstreamRequest).toHaveBeenCalledWith(
      'api.test',
      'server_error',
      expect.any(Number),
    );
  });

  it('distinguishes a timeout from an unreachable host', async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    await expect(
      clientWith(hanging, configWith({ timeoutMs: 5, maxAttempts: 1 })).send({
        method: 'GET',
        url: 'https://api.test/x',
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });

    expect(metrics.upstreamRequest).toHaveBeenCalledWith('api.test', 'timeout', expect.any(Number));
  });

  it('reports a transport failure as unreachable', async () => {
    const refusing: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));

    await expect(
      clientWith(refusing, configWith({ maxAttempts: 1 })).send({
        method: 'GET',
        url: 'https://api.test/x',
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE' });
  });

  it('opens the circuit after the threshold and then stops calling the host', async () => {
    const refusing = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const client = clientWith(refusing, configWith({ maxAttempts: 1, breakerThreshold: 2 }));
    const call = () => client.send({ method: 'GET', url: 'https://api.test/x' });

    await expect(call()).rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE' });
    await expect(call()).rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE' });

    refusing.mockClear();
    await expect(call()).rejects.toMatchObject({ code: 'UPSTREAM_CIRCUIT_OPEN' });
    expect(refusing).not.toHaveBeenCalled();
  });

  it('keeps one breaker per host, so a dead carrier does not block the gateway', async () => {
    const failFirstHost: FetchLike = (url) =>
      url.includes('dead.test')
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(new Response('ok', { status: 200 }));
    const client = clientWith(failFirstHost, configWith({ maxAttempts: 1, breakerThreshold: 1 }));

    await expect(client.send({ method: 'GET', url: 'https://dead.test/x' })).rejects.toBeDefined();
    await expect(client.send({ method: 'GET', url: 'https://dead.test/x' })).rejects.toMatchObject({
      code: 'UPSTREAM_CIRCUIT_OPEN',
    });

    await expect(client.send({ method: 'GET', url: 'https://live.test/x' })).resolves.toMatchObject(
      { status: 200 },
    );
  });

  it('probes again once the reset window has elapsed', async () => {
    let failing = true;
    const flaky: FetchLike = () =>
      failing
        ? Promise.reject(new Error('down'))
        : Promise.resolve(new Response('', { status: 200 }));
    const client = clientWith(flaky, configWith({ maxAttempts: 1, breakerThreshold: 1 }));

    await expect(client.send({ method: 'GET', url: 'https://api.test/x' })).rejects.toBeDefined();

    failing = false;
    now += 1000;

    await expect(client.send({ method: 'GET', url: 'https://api.test/x' })).resolves.toMatchObject({
      status: 200,
    });
  });

  it('refuses a url that is not absolute, before any socket is opened', async () => {
    const fetchImpl = responding(200);

    await expect(
      clientWith(fetchImpl).send({ method: 'GET', url: '/relative' }),
    ).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_URL' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes the method, headers and body through untouched', async () => {
    const fetchImpl = responding(200);

    await clientWith(fetchImpl).send({
      method: 'PUT',
      url: 'https://api.test/x',
      headers: { authorization: 'Bearer t' },
      body: '{"a":1}',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/x',
      expect.objectContaining({
        method: 'PUT',
        headers: { authorization: 'Bearer t' },
        body: '{"a":1}',
      }),
    );
  });
});
