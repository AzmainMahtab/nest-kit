import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  Clock,
  HttpClient,
  isRetryable,
  UpstreamRequest,
  UpstreamResponse,
  UpstreamCircuitOpen,
  UpstreamTimeout,
  UpstreamUnreachable,
} from '../../shared/application';
import { AppError } from '../../shared/errors';
import { AppConfig } from '../config';
import { MetricsService } from '../observability/metrics.service';
import { backoffDelayMs } from './backoff';
import { CircuitBreaker } from './circuit-breaker';

export const UPSTREAM_FETCH = Symbol('UPSTREAM_FETCH');

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Outcomes that become a metric label, so the set has to stay small and fixed. */
type Outcome = 'ok' | 'client_error' | 'server_error' | 'timeout' | 'unreachable' | 'circuit_open';

@Injectable()
export class FetchHttpClient extends HttpClient {
  private readonly logger = new Logger(FetchHttpClient.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly metrics: MetricsService,
    @Inject(UPSTREAM_FETCH) private readonly fetchImpl: FetchLike,
  ) {
    super();
  }

  async send(request: UpstreamRequest): Promise<UpstreamResponse> {
    const host = this.hostOf(request.url);
    const breaker = this.breakerFor(host);

    if (!breaker.allow()) {
      this.metrics.upstreamRequest(host, 'circuit_open', 0);
      throw UpstreamCircuitOpen();
    }

    const { maxAttempts, retryBaseMs, retryMaxMs } = this.config.upstream;
    const attempts = isRetryable(request) ? maxAttempts : 1;
    const startedAt = this.clock.now().getTime();
    let lastError: AppError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.once(request);

        // A 5xx is the upstream telling us it is broken, which is exactly what
        // the breaker counts. A 4xx is us being wrong, and tripping a breaker
        // on our own bad requests would take out a healthy dependency.
        if (response.status >= 500) {
          if (attempt < attempts) {
            await this.pause(attempt, retryBaseMs, retryMaxMs);
            continue;
          }
          breaker.failed();
          this.finish(host, 'server_error', startedAt);
          return response;
        }

        breaker.succeeded();
        this.finish(host, response.status >= 400 ? 'client_error' : 'ok', startedAt);
        return response;
      } catch (error) {
        lastError = error instanceof AppError ? error : UpstreamUnreachable(error);

        if (attempt < attempts) {
          await this.pause(attempt, retryBaseMs, retryMaxMs);
          continue;
        }
      }
    }

    breaker.failed();
    const outcome: Outcome = lastError?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'unreachable';
    this.finish(host, outcome, startedAt);
    this.logger.warn(`${request.method} ${host} failed after ${attempts} attempt(s): ${outcome}`);

    throw lastError ?? UpstreamUnreachable();
  }

  private async once(request: UpstreamRequest): Promise<UpstreamResponse> {
    const timeoutMs = request.timeoutMs ?? this.config.upstream.timeoutMs;
    const controller = new AbortController();
    // Distinguishes "we gave up" from "the socket died", which are different
    // faults with different fixes and must not share an error code.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      };
    } catch (error) {
      throw timedOut ? UpstreamTimeout(timeoutMs, error) : UpstreamUnreachable(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private breakerFor(host: string): CircuitBreaker {
    let breaker = this.breakers.get(host);
    if (!breaker) {
      const { breakerThreshold, breakerResetMs } = this.config.upstream;
      breaker = new CircuitBreaker(breakerThreshold, breakerResetMs, () =>
        this.clock.now().getTime(),
      );
      this.breakers.set(host, breaker);
    }
    return breaker;
  }

  /**
   * The host, never the full URL. A path carries order ids and tokens, and a
   * metric label with an unbounded value is a cardinality incident — see the
   * repository rules.
   */
  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      throw AppError.invalid('INVALID_UPSTREAM_URL', 'upstream url is not absolute');
    }
  }

  private finish(host: string, outcome: Outcome, startedAtMs: number): void {
    this.metrics.upstreamRequest(host, outcome, (this.clock.now().getTime() - startedAtMs) / 1000);
  }

  private pause(attempt: number, baseMs: number, maxMs: number): Promise<void> {
    const delay = backoffDelayMs(attempt, baseMs, maxMs, Math.random);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
