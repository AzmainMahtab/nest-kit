import { AppError } from '../../../shared/errors';

/**
 * Deliberately identical whether the address is unknown or the password is
 * wrong. Distinguishing them turns the login endpoint into a user enumeration
 * oracle.
 */
export const InvalidCredentials = (): AppError =>
  AppError.unauthorized('INVALID_CREDENTIALS', 'invalid email or password');

export const AccountSuspended = (): AppError =>
  AppError.forbidden('ACCOUNT_SUSPENDED', 'this account is suspended');

export const SessionNotActive = (): AppError =>
  AppError.unauthorized('SESSION_NOT_ACTIVE', 'session is expired or revoked');

export const RefreshTokenReplayed = (): AppError =>
  AppError.unauthorized('REFRESH_TOKEN_REPLAYED', 'refresh token has already been used');
