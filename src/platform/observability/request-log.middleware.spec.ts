import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { RequestLogMiddleware } from './request-log.middleware';

interface Recorded {
  logged: string[];
  errored: string[];
  nexted: boolean;
}

function serve(request: Partial<Request>, statusCode: number): Recorded {
  const recorded: Recorded = { logged: [], errored: [], nexted: false };

  jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
    recorded.logged.push(String(m));
  });
  jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
    recorded.errored.push(String(m));
  });

  let onFinish: (() => void) | undefined;
  const response = {
    statusCode,
    on: (event: string, handler: () => void) => {
      if (event === 'finish') onFinish = handler;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    recorded.nexted = true;
  };

  new RequestLogMiddleware().use(
    { method: 'GET', path: '/', originalUrl: '/', ...request } as Request,
    response,
    next,
  );
  onFinish?.();

  return recorded;
}

describe('RequestLogMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs method, url, status and duration once the response is sent', () => {
    const recorded = serve(
      { method: 'POST', path: '/api/v1/users', originalUrl: '/api/v1/users' },
      201,
    );

    expect(recorded.logged).toHaveLength(1);
    expect(recorded.logged[0]).toMatch(/^POST \/api\/v1\/users 201 \d+\.\dms$/);
    expect(recorded.nexted).toBe(true);
  });

  it('logs the full url, not the route pattern', () => {
    // The opposite of the metrics rule: a log line is read one at a time, and
    // which user was fetched is the whole point.
    const url = '/api/v1/users/019fd1c2-6f4a-7c31-9a2e-6d0f7b8c1a55';
    expect(serve({ path: url, originalUrl: url }, 200).logged[0]).toContain(url);
  });

  it('raises only 5xx to error level', () => {
    // A 401 is the guard doing its job, not an incident worth paging on.
    expect(serve({ path: '/api/v1/users', originalUrl: '/api/v1/users' }, 401).errored).toEqual([]);
    expect(
      serve({ path: '/api/v1/users', originalUrl: '/api/v1/users' }, 500).errored,
    ).toHaveLength(1);
  });

  it.each(['/health', '/health/ready', '/metrics'])('says nothing about %s', (path) => {
    // A probe every five seconds is 17k lines a day that carry no information.
    const recorded = serve({ path, originalUrl: path }, 200);

    expect(recorded.logged).toEqual([]);
    expect(recorded.nexted).toBe(true);
  });
});
