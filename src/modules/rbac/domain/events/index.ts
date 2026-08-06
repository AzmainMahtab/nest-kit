import { DomainEvent } from '../../../../shared/domain';

export class PermissionCreated extends DomainEvent {
  readonly name = 'rbac.permission.created';

  constructor(
    readonly permissionUuid: string,
    readonly permissionName: string,
  ) {
    super();
  }
}

export class RoleCreated extends DomainEvent {
  readonly name = 'rbac.role.created';

  constructor(
    readonly roleUuid: string,
    readonly roleName: string,
  ) {
    super();
  }
}

/**
 * Carries the role's uuid rather than the affected users: a role may be held by
 * more than a page of them, and an event is not the place to enumerate a table.
 * The cache invalidator expands the role to its holders when it reacts.
 */
export class RolePermissionGranted extends DomainEvent {
  readonly name = 'rbac.role.permission-granted';

  constructor(
    readonly roleUuid: string,
    readonly permissionName: string,
  ) {
    super();
  }
}

export class RolePermissionRevoked extends DomainEvent {
  readonly name = 'rbac.role.permission-revoked';

  constructor(
    readonly roleUuid: string,
    readonly permissionName: string,
  ) {
    super();
  }
}

export class RoleAssignedToUser extends DomainEvent {
  readonly name = 'rbac.role.assigned';

  constructor(
    readonly userUuid: string,
    readonly roleUuid: string,
    readonly roleName: string,
  ) {
    super();
  }
}

export class RoleUnassignedFromUser extends DomainEvent {
  readonly name = 'rbac.role.unassigned';

  constructor(
    readonly userUuid: string,
    readonly roleUuid: string,
    readonly roleName: string,
  ) {
    super();
  }
}
