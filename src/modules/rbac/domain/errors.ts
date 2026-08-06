import { AppError } from '../../../shared/errors';

export const PermissionNotFound = (): AppError =>
  AppError.notFound('PERMISSION_NOT_FOUND', 'permission not found');

export const RoleNotFound = (): AppError => AppError.notFound('ROLE_NOT_FOUND', 'role not found');

export const PermissionAlreadyExists = (): AppError =>
  AppError.conflict('PERMISSION_ALREADY_EXISTS', 'permission already exists').withField(
    'name',
    'already exists',
  );

export const RoleAlreadyExists = (): AppError =>
  AppError.conflict('ROLE_ALREADY_EXISTS', 'role already exists').withField(
    'name',
    'already exists',
  );

export const InvalidPermissionName = (raw: string): AppError =>
  AppError.invalid(
    'INVALID_PERMISSION_NAME',
    `'${raw}' is not a permission name — expected lowercase resource:action`,
  ).withField('name', 'expected lowercase resource:action');

export const InvalidRoleName = (raw: string): AppError =>
  AppError.invalid(
    'INVALID_ROLE_NAME',
    `'${raw}' is not a role name — expected lowercase letters, digits and hyphens`,
  ).withField('name', 'expected lowercase letters, digits and hyphens');

/**
 * Raised when a delete or a rename would strip the last route to the permission
 * that guards role administration. Without it the system locks itself out and
 * only a hand-written SQL statement can recover it.
 */
export const RoleIsProtected = (name: string): AppError =>
  AppError.conflict('ROLE_IS_PROTECTED', `the '${name}' role cannot be modified or removed`);
