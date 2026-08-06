import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { AccessControl } from '../../../shared/application';
import { CURRENT_USER_KEY, CurrentUser } from '../../../shared/auth-context';
import { AppError } from '../../../shared/errors';
import { REQUIRED_PERMISSIONS_KEY, REQUIRED_ROLES_KEY } from '../decorators/authorization.metadata';

/**
 * Authorization, applied per route by `@RequirePermissions()` / `@RequireRoles()`.
 *
 * Deliberately *not* an `APP_GUARD`. A second global guard would have to run
 * after `JwtAuthGuard` to see the caller it attaches, and the order of global
 * guards is the order their modules happen to be resolved in — a route would
 * silently start returning 401 to valid tokens if that order ever shifted.
 * Route-scoped guards always run after every global one, so attaching this to
 * the decorator makes the ordering a property of Nest rather than of an imports
 * array.
 *
 * Authentication stays deny-by-default and global; authorization is opt-in per
 * route, because a route that needs no permission is the common case.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessControl,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_KEY, targets) ?? [];
    const permissions =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, targets) ?? [];

    if (roles.length === 0 && permissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const currentUser = (request as Request & Record<string, CurrentUser | undefined>)[
      CURRENT_USER_KEY
    ];

    // Only reachable if the route is also `@Public()`, which is a wiring
    // mistake: there is no caller to authorize. Fail closed and say so.
    if (!currentUser) {
      throw AppError.unauthorized('MISSING_TOKEN', 'authentication required');
    }

    const grants = await this.access.grantsFor(currentUser.uuid);

    // Any-of, across both lists: holding one of the named permissions, or one
    // of the named roles, is enough. Requiring *all* of them is deliberately
    // not expressible — compose a permission that means the combination
    // instead, so the rule lives in the role definition rather than smeared
    // across controllers.
    const allowed =
      permissions.some((permission) => grants.permissions.includes(permission)) ||
      roles.some((role) => grants.roles.includes(role));

    if (!allowed) {
      throw AppError.forbidden('FORBIDDEN', 'insufficient permissions');
    }

    return true;
  }
}
