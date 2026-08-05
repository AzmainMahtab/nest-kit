import { AppError } from '../../../shared/errors';

export const OwnerNotFound = (): AppError =>
  AppError.notFound('OWNER_NOT_FOUND', 'owner not found');

export const OwnerAlreadyRegistered = (): AppError =>
  AppError.conflict('OWNER_ALREADY_REGISTERED', 'this user is already an owner').withField(
    'userUuid',
    'already registered as an owner',
  );

export const OwnerInactive = (): AppError =>
  AppError.conflict('OWNER_INACTIVE', 'owner is not active');
