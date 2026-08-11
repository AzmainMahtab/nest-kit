import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

import { AppError, ErrorItem, ErrorKind } from '../../../shared/errors';
import { correlationIdOf } from '../../observability/correlation-id.middleware';
import { ErrorEnvelope } from '../responses/envelope';

/**
 * The only error path. Controllers do not catch, and no module declares its own
 * mapper — adding an error code must not require touching this file.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const error = this.toAppError(exception);
    const correlationId = correlationIdOf(request);

    if (error.kind === ErrorKind.Internal) {
      this.logger.error(
        `${request.method} ${request.url} — ${error.code}`,
        this.stackOf(exception),
      );
    }

    const body: ErrorEnvelope = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    response.status(error.status).json(body);
  }

  private toAppError(exception: unknown): AppError {
    if (exception instanceof AppError) {
      return exception;
    }

    // Framework-raised exceptions: unmatched route, payload too large, throttling.
    // Application code must never throw these — see AGENTS.md §4.
    if (exception instanceof HttpException) {
      return new AppError(
        this.kindForStatus(exception.getStatus()),
        this.codeForStatus(exception.getStatus()),
        exception.message,
        this.detailsOf(exception),
      );
    }

    return AppError.internal(exception);
  }

  private detailsOf(exception: HttpException): ErrorItem[] {
    const body = exception.getResponse();

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const { message } = body;

      if (Array.isArray(message)) {
        return message.map((m) => ({
          field: '',
          code: 'VALIDATION_FAILED',
          message: String(m),
        }));
      }
    }

    return [];
  }

  private kindForStatus(status: number): ErrorKind {
    switch (status) {
      case 400:
        return ErrorKind.Invalid;
      case 401:
        return ErrorKind.Unauthorized;
      case 403:
        return ErrorKind.Forbidden;
      case 404:
        return ErrorKind.NotFound;
      case 409:
        return ErrorKind.Conflict;
      case 429:
        return ErrorKind.RateLimited;
      default:
        return status < 500 ? ErrorKind.Invalid : ErrorKind.Internal;
    }
  }

  private codeForStatus(status: number): string {
    return this.kindForStatus(status);
  }

  private stackOf(exception: unknown): string | undefined {
    if (exception instanceof AppError && exception.cause instanceof Error) {
      return exception.cause.stack;
    }
    return exception instanceof Error ? exception.stack : undefined;
  }
}
