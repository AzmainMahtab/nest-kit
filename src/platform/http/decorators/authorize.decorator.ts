import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';

import { AuthorizationGuard } from '../guards/authorization.guard';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_ROLES_KEY } from './authorization.metadata';

/**
 * Requires any one of the named permissions, e.g.
 * `@RequirePermissions('messaging:admin')`.
 *
 * Prefer this over `@RequireRoles()` everywhere. A permission is the stable
 * thing — `messaging:admin` means the same in a year — whereas which roles
 * carry it is an operational decision that should be changeable without a
 * deploy. Naming a role in a controller freezes that decision in the code.
 *
 * The guard comes with the decorator rather than being registered globally, so
 * a route cannot end up declaring a requirement that nothing enforces.
 */
export const RequirePermissions = (...permissions: string[]) =>
  applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    UseGuards(AuthorizationGuard),
  );

/**
 * Requires any one of the named roles.
 *
 * The escape hatch, for a route that genuinely guards *being* something rather
 * than being able to do something. Reach for `@RequirePermissions()` first.
 */
export const RequireRoles = (...roles: string[]) =>
  applyDecorators(SetMetadata(REQUIRED_ROLES_KEY, roles), UseGuards(AuthorizationGuard));
