import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { Grants } from '../../../../shared/application';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { RoleNotFound } from '../../domain/errors';
import { Permission } from '../../domain/permission';
import { RbacRepository } from '../../domain/ports/rbac-repository.port';
import { Role } from '../../domain/role';
import { RoleAssignment } from '../../domain/role-assignment';

export class GetRoleQuery {
  constructor(readonly uuid: string) {}
}

export class ListRolesQuery {
  constructor(readonly pagination: PaginationParams) {}
}

export class ListPermissionsQuery {
  constructor(readonly pagination: PaginationParams) {}
}

export class GetUserAssignmentsQuery {
  constructor(readonly userUuid: string) {}
}

export class GetUserGrantsQuery {
  constructor(readonly userUuid: string) {}
}

@QueryHandler(GetRoleQuery)
export class GetRoleHandler implements IQueryHandler<GetRoleQuery, Role> {
  constructor(private readonly rbac: RbacRepository) {}

  async execute(query: GetRoleQuery): Promise<Role> {
    const role = await this.rbac.findRoleByUuid(query.uuid);

    if (!role) {
      throw RoleNotFound();
    }

    return role;
  }
}

@QueryHandler(ListRolesQuery)
export class ListRolesHandler implements IQueryHandler<ListRolesQuery, Page<Role>> {
  constructor(private readonly rbac: RbacRepository) {}

  execute(query: ListRolesQuery): Promise<Page<Role>> {
    return this.rbac.listRoles(query.pagination);
  }
}

@QueryHandler(ListPermissionsQuery)
export class ListPermissionsHandler implements IQueryHandler<
  ListPermissionsQuery,
  Page<Permission>
> {
  constructor(private readonly rbac: RbacRepository) {}

  execute(query: ListPermissionsQuery): Promise<Page<Permission>> {
    return this.rbac.listPermissions(query.pagination);
  }
}

@QueryHandler(GetUserAssignmentsQuery)
export class GetUserAssignmentsHandler implements IQueryHandler<
  GetUserAssignmentsQuery,
  RoleAssignment[]
> {
  constructor(private readonly rbac: RbacRepository) {}

  execute(query: GetUserAssignmentsQuery): Promise<RoleAssignment[]> {
    return this.rbac.findAssignmentsForUser(query.userUuid);
  }
}

/**
 * Reads through the repository, not the cache: this answers "what is true now"
 * for an administrator inspecting a user, where a stale answer would be read as
 * a bug. The cached path exists for the guard, which runs on every request.
 */
@QueryHandler(GetUserGrantsQuery)
export class GetUserGrantsHandler implements IQueryHandler<GetUserGrantsQuery, Grants> {
  constructor(private readonly rbac: RbacRepository) {}

  execute(query: GetUserGrantsQuery): Promise<Grants> {
    return this.rbac.grantsFor(query.userUuid);
  }
}
