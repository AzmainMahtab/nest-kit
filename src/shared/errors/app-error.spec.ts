import { AppError } from './app-error';
import { ErrorKind } from './error-kind';

describe('AppError', () => {
  it('maps each kind to its status', () => {
    expect(AppError.notFound('X', 'x').status).toBe(404);
    expect(AppError.conflict('X', 'x').status).toBe(409);
    expect(AppError.invalid('X', 'x').status).toBe(400);
    expect(AppError.unauthorized('X', 'x').status).toBe(401);
    expect(AppError.forbidden('X', 'x').status).toBe(403);
    expect(AppError.internal(new Error('boom')).status).toBe(500);
  });

  it('survives instanceof after extending Error', () => {
    const err: unknown = AppError.notFound('USER_NOT_FOUND', 'user not found');

    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it('matches on code, not message text', () => {
    const err = AppError.notFound('USER_NOT_FOUND', 'user not found');

    expect(AppError.is(err, 'USER_NOT_FOUND')).toBe(true);
    expect(AppError.is(err, 'ORDER_NOT_FOUND')).toBe(false);
    expect(AppError.is(new Error('user not found'), 'USER_NOT_FOUND')).toBe(false);
  });

  it('accumulates field detail without mutating the original', () => {
    const base = AppError.conflict('EMAIL_TAKEN', 'email already registered');
    const withField = base.withField('email', 'already registered');

    expect(base.details).toHaveLength(0);
    expect(withField.details).toEqual([
      { field: 'email', code: 'EMAIL_TAKEN', message: 'already registered' },
    ]);
    expect(withField.kind).toBe(ErrorKind.Conflict);
  });

  it('keeps the internal cause off the message', () => {
    const cause = new Error('connection refused: 10.0.0.4:5432');
    const err = AppError.internal(cause);

    expect(err.message).toBe('internal server error');
    expect(err.cause).toBe(cause);
  });
});
