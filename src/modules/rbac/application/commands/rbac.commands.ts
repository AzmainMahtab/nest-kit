export class CreatePermissionCommand {
  constructor(
    readonly name: string,
    readonly description: string,
  ) {}
}

export class CreateRoleCommand {
  constructor(
    readonly name: string,
    readonly description: string,
  ) {}
}

export class GrantPermissionCommand {
  constructor(
    readonly roleUuid: string,
    readonly permissionName: string,
    /** The administrator making the change, for the audit row. */
    readonly grantedBy: string | null,
  ) {}
}

export class RevokePermissionCommand {
  constructor(
    readonly roleUuid: string,
    readonly permissionName: string,
  ) {}
}

export class AssignRoleCommand {
  constructor(
    readonly userUuid: string,
    readonly roleUuid: string,
    readonly assignedBy: string | null,
  ) {}
}

export class UnassignRoleCommand {
  constructor(
    readonly userUuid: string,
    readonly roleUuid: string,
  ) {}
}
