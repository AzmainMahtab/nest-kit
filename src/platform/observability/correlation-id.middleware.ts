import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';

import { RequestContextStore } from './request-context';

export const CORRELATION_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_KEY = 'correlationId';

/** Long enough for a uuid or a trace id, short enough to be safe in a log line. */
const MAX_LENGTH = 128;
const SAFE = /^[\w.:-]+$/;

/**
 * Assigns every request an id, echoes it back, and makes it readable for the
 * lifetime of the request.
 *
 * An id supplied by the caller is honoured so a trace survives the hop from an
 * upstream service or a browser — but only after it is checked: an id is
 * written verbatim into structured logs and a response header, and an
 * unvalidated one lets a caller inject newlines into the log stream or
 * poison a dashboard label.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = this.incoming(request) ?? uuidv7();

    (request as Request & Record<string, string>)[CORRELATION_ID_KEY] = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    RequestContextStore.run({ correlationId }, () => {
      next();
    });
  }

  private incoming(request: Request): string | null {
    const raw = request.headers[CORRELATION_ID_HEADER] ?? request.headers['x-correlation-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;

    if (!value || value.length > MAX_LENGTH || !SAFE.test(value)) {
      return null;
    }

    return value;
  }
}

/** The id of the request being served, for code holding the express request. */
export function correlationIdOf(request: Request): string | undefined {
  return (request as Request & Record<string, string | undefined>)[CORRELATION_ID_KEY];
}
