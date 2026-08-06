import { Global, Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { AccessControl } from '../../shared/application';
import {
  AssignRoleHandler,
  CreatePermissionHandler,
  CreateRoleHandler,
  GrantPermissionHandler,
  RevokePermissionHandler,
  UnassignRoleHandler,
} from './application/commands/rbac.handlers';
import {
  GetRoleHandler,
  GetUserAssignmentsHandler,
  GetUserGrantsHandler,
  ListPermissionsHandler,
  ListRolesHandler,
} from './application/queries/rbac.queries';
import { RbacRepository } from './domain/ports/rbac-repository.port';
import { RedisAccessControl } from './infrastructure/cache/redis-access-control';
import {
  InvalidateGrantsOnAssignment,
  InvalidateGrantsOnRoleChange,
} from './infrastructure/event-handlers/invalidate-grants.handler';
import { TypeOrmRbacRepository } from './infrastructure/persistence/typeorm-rbac.repository';
import { RbacBootstrap } from './infrastructure/rbac-bootstrap.service';
import { PermissionsController } from './presentation/http/permissions.controller';
import { RolesController } from './presentation/http/roles.controller';
import { UserRolesController } from './presentation/http/user-roles.controller';

const handlers = [
  CreatePermissionHandler,
  CreateRoleHandler,
  GrantPermissionHandler,
  RevokePermissionHandler,
  AssignRoleHandler,
  UnassignRoleHandler,
  GetRoleHandler,
  ListRolesHandler,
  ListPermissionsHandler,
  GetUserAssignmentsHandler,
  GetUserGrantsHandler,
];

/**
 * Global, unlike every other context.
 *
 * `AuthorizationGuard` is attached by `@RequirePermissions()` wherever a route
 * needs it, and Nest instantiates a route-scoped guard in the injector of the
 * module that declares the controller. Without `@Global()` every such module —
 * including `platform/messaging` — would have to import this one, which would
 * point platform code at a bounded context and invert the layering.
 *
 * What crosses the boundary is still only the `AccessControl` port from
 * `shared/`. Nothing outside this folder sees a role, a permission or the
 * repository (AGENTS.md §13).
 */
@Global()
@Module({
  // For identity's UserRepository port only: the assign use case checks the
  // user exists, and the bootstrap resolves an email to a uuid.
  imports: [IdentityModule],
  controllers: [RolesController, PermissionsController, UserRolesController],
  providers: [
    { provide: RbacRepository, useClass: TypeOrmRbacRepository },
    RedisAccessControl,
    // useExisting, not useClass: the invalidation handlers inject the concrete
    // adapter for its `invalidate()`, and a second instance would cache-aside
    // over its own state.
    { provide: AccessControl, useExisting: RedisAccessControl },
    ...handlers,
    InvalidateGrantsOnAssignment,
    InvalidateGrantsOnRoleChange,
    RbacBootstrap,
  ],
  exports: [AccessControl, RbacRepository],
})
export class RbacModule {}
