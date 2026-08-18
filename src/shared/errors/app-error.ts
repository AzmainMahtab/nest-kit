import { ERROR_KIND_STATUS, ErrorKind } from './error-kind';

export interface ErrorItem {
  field: string;
  code: string;
  message: string;
}

export class AppError extends Error {
  readonly details: ErrorItem[];

  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    details: ErrorItem[] = [],
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  get status(): number {
    return ERROR_KIND_STATUS[this.kind];
  }

  withField(field: string, message: string, code = this.code): AppError {
    return new AppError(
      this.kind,
      this.code,
      this.message,
      [...this.details, { field, code, message }],
      this.cause,
    );
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(ErrorKind.NotFound, code, message);
  }

  static conflict(code: string, message: string): AppError {
    return new AppError(ErrorKind.Conflict, code, message);
  }

  static invalid(code: string, message: string): AppError {
    return new AppError(ErrorKind.Invalid, code, message);
  }

  static unauthorized(code: string, message: string): AppError {
    return new AppError(ErrorKind.Unauthorized, code, message);
  }

  static forbidden(code: string, message: string): AppError {
    return new AppError(ErrorKind.Forbidden, code, message);
  }

  static payloadTooLarge(code: string, message: string): AppError {
    return new AppError(ErrorKind.PayloadTooLarge, code, message);
  }

  static rateLimited(code: string, message: string): AppError {
    return new AppError(ErrorKind.RateLimited, code, message);
  }

  static validation(field: string, message: string, code = 'VALIDATION_FAILED'): AppError {
    return new AppError(ErrorKind.Invalid, code, 'validation failed', [{ field, code, message }]);
  }

  static internal(cause: unknown, code = 'INTERNAL_ERROR'): AppError {
    return new AppError(ErrorKind.Internal, code, 'internal server error', [], cause);
  }

  static is(err: unknown, code?: string): err is AppError {
    return err instanceof AppError && (code === undefined || err.code === code);
  }
}
