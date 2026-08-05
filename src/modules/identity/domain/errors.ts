import { AppError } from '../../../shared/errors';

export const UserNotFound = (): AppError => AppError.notFound('USER_NOT_FOUND', 'user not found');

export const EmailAlreadyRegistered = (): AppError =>
  AppError.conflict('EMAIL_ALREADY_REGISTERED', 'email already registered').withField(
    'email',
    'already registered',
  );

export const UserAlreadyDeleted = (): AppError =>
  AppError.conflict('USER_ALREADY_DELETED', 'user is already deleted');

export const InvalidStatusTransition = (from: string, to: string): AppError =>
  AppError.invalid(
    'INVALID_STATUS_TRANSITION',
    `cannot move a user from ${from} to ${to}`,
  ).withField('status', `invalid transition from ${from}`);
