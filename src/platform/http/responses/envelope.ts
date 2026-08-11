import { ErrorItem } from '../../../shared/errors';

/**
 * Fixed external contract. Do not rename fields — clients depend on them.
 */
export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details: ErrorItem[];
  };
  path: string;
  timestamp: string;
  /**
   * The `X-Request-Id` of the failing request. It is the one thing a user can
   * read off a screen and paste into a log query, so it belongs in the body
   * and not only in a header nobody sees.
   */
  correlationId?: string;
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
