import { AppError, ErrorKind } from '../../errors';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Methods a retry cannot turn into a second side effect. */
const NATURALLY_IDEMPOTENT: ReadonlySet<HttpMethod> = new Set<HttpMethod>([
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
]);

export interface UpstreamRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Overrides the configured default for this one call. */
  readonly timeoutMs?: number;
  /**
   * Whether this call may be retried.
   *
   * Defaults to true for GET/HEAD/PUT/DELETE and **false for POST and PATCH**,
   * because the retry that turns one charge into two is the expensive kind of
   * bug and the safe default is the one nobody has to remember. A POST that
   * carries an idempotency key the upstream honours can opt back in.
   */
  readonly idempotent?: boolean;
}

export interface UpstreamResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export function isRetryable(request: UpstreamRequest): boolean {
  return request.idempotent ?? NATURALLY_IDEMPOTENT.has(request.method);
}

/**
 * Messages stay host-free: an error envelope reaches a client, and the names
 * of the services behind an API are not a client's business. The host goes in
 * the log line and the metric label instead.
 */
export const UpstreamTimeout = (timeoutMs: number, cause?: unknown): AppError =>
  new AppError(
    ErrorKind.Internal,
    'UPSTREAM_TIMEOUT',
    `an upstream dependency did not respond within ${timeoutMs}ms`,
    [],
    cause,
  );

export const UpstreamUnreachable = (cause?: unknown): AppError =>
  new AppError(
    ErrorKind.Internal,
    'UPSTREAM_UNREACHABLE',
    'an upstream dependency could not be reached',
    [],
    cause,
  );

export const UpstreamCircuitOpen = (): AppError =>
  new AppError(
    ErrorKind.Internal,
    'UPSTREAM_CIRCUIT_OPEN',
    'an upstream dependency is failing and calls to it are suspended',
  );

/**
 * Every call that leaves this process.
 *
 * It exists so that timeouts, retries and the circuit breaker are decided once
 * rather than per integration. A context that talks to a carrier or a payment
 * gateway injects this and writes the request; it does not get to choose
 * whether there is a timeout, which is the choice that is always wrong the
 * first time an upstream hangs.
 *
 * A non-2xx is a *response*, not a throw — a 404 from an upstream is often the
 * answer. Only transport failures, timeouts and an open circuit throw.
 */
export abstract class HttpClient {
  abstract send(request: UpstreamRequest): Promise<UpstreamResponse>;
}
