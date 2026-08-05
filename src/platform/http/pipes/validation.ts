import { ValidationError, ValidationPipe } from '@nestjs/common';

import { AppError, ErrorItem } from '../../../shared/errors';

/**
 * Validation failures enter the same error model as everything else, so the
 * filter has one shape to render and clients have one shape to parse.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new AppError('INVALID', 'VALIDATION_FAILED', 'validation failed', flatten(errors)),
  });
}

function flatten(errors: ValidationError[], parent = ''): ErrorItem[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;

    const own = Object.entries(error.constraints ?? {}).map(([code, message]) => ({
      field,
      code,
      message,
    }));

    return [...own, ...flatten(error.children ?? [], field)];
  });
}
