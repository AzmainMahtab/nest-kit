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
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
