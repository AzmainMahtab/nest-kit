import { NextFunction, Request, Response } from 'express';

import {
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  correlationIdOf,
} from './correlation-id.middleware';
import { RequestContextStore } from './request-context';

function run(headers: Record<string, string | string[]> = {}): {
  assigned: string;
  seenInsideHandler: string | undefined;
} {
  const middleware = new CorrelationIdMiddleware();
  const request = { headers } as unknown as Request;
  const set: Record<string, unknown> = {};
  const response = { setHeader: (k: string, v: unknown) => (set[k] = v) } as unknown as Response;

  let seenInsideHandler: string | undefined;
  const next: NextFunction = () => {
    seenInsideHandler = RequestContextStore.correlationId();
  };

  middleware.use(request, response, next);

  return { assigned: String(set[CORRELATION_ID_HEADER]), seenInsideHandler };
}

describe('CorrelationIdMiddleware', () => {
  it('assigns an id and makes it readable for the rest of the request', () => {
    const { assigned, seenInsideHandler } = run();

    expect(assigned).toMatch(/^[\w-]{20,}$/);
    expect(seenInsideHandler).toBe(assigned);
  });

  it('honours a well-formed id from the caller so a trace survives the hop', () => {
    expect(run({ [CORRELATION_ID_HEADER]: 'edge-7f3a' }).assigned).toBe('edge-7f3a');
    expect(run({ 'x-correlation-id': 'edge-7f3a' }).assigned).toBe('edge-7f3a');
  });

  it.each([
    ['a newline', 'abc\ndef'],
    ['a quote that could forge a JSON field', 'abc","level":"info'],
    ['whitespace', 'abc def'],
    ['something absurdly long', 'a'.repeat(200)],
  ])('replaces an id containing %s', (_case, forged) => {
    // It is written verbatim into a log line and a response header, so an
    // unchecked value is a log-injection primitive.
    expect(run({ [CORRELATION_ID_HEADER]: forged }).assigned).not.toBe(forged);
  });

  it('exposes the id on the request for code that has no async context', () => {
    const middleware = new CorrelationIdMiddleware();
    const request = { headers: { [CORRELATION_ID_HEADER]: 'edge-1' } } as unknown as Request;
    const response = { setHeader: () => undefined } as unknown as Response;

    middleware.use(request, response, () => undefined);

    expect(correlationIdOf(request)).toBe('edge-1');
  });
});
