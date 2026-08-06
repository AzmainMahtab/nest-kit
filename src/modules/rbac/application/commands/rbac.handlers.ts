import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { UserRepository } from '../../../identity';
import { Clock, EventBus, UnitOfWork } from '../../../../shared/application';
import { AppError } from '../../../../shared/errors';
import {
  PermissionAlreadyExists,
  PermissionNotFound,
  RoleAlreadyExists,
  RoleNotFound,
} from '../../domain/errors';
import { RoleAssignedToUser, RoleUnassignedFromUser } from '../../domain/events';
import { Permission } from '../../domain/permission';
import { RbacRepository } from '../../domain/ports/rbac-repository.port';
import { Role } from '../../domain/role';
import { PermissionName } from '../../domain/value-objects/permission-name';
import { RoleName } from '../../domain/value-objects/role-name';
import {
  AssignRoleCommand,
  CreatePermissionCommand,
  CreateRoleCommand,
  GrantPermissionCommand,
  RevokePermissionCommand,
  UnassignRoleCommand,
} from './rbac.commands';

@CommandHandler(CreatePermissionCommand)
export class CreatePermissionHandler implements ICommandHandler<
  CreatePermissionCommand,
  Permission
> {
  constructor(
    private readonly rbac: RbacRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreatePermissionCommand): Promise<Permission> {
    // Built before the transaction: a malformed name is a validation failure and
    // there is no reason to open a transaction for it.
    const name = PermissionName.of(command.name);

    return this.uow.withTransaction(async () => {
      if (await this.rbac.findPermissionByName(name)) {
        throw PermissionAlreadyExists();
      }

      const permission = Permission.create(name, command.description, this.clock.now());
      await this.rbac.savePermission(permission);
      await this.events.publishAll(permission.pullEvents());

      return permission;
    });
  }
}

@CommandHandler(CreateRoleCommand)
export class CreateRoleHandler implements ICommandHandler<CreateRoleCommand, Role> {
  constructor(
    private readonly rbac: RbacRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreateRoleCommand): Promise<Role> {
    const name = RoleName.of(command.name);

    return this.uow.withTransaction(async () => {
      if (await this.rbac.findRoleByName(name)) {
        throw RoleAlreadyExists();
      }

      const role = Role.create(name, command.description, this.clock.now());
      await this.rbac.saveRole(role);
      await this.events.publishAll(role.pullEvents());

      return role;
    });
  }
}

@CommandHandler(GrantPermissionCommand)
export class GrantPermissionHandler implements ICommandHandler<GrantPermissionCommand, Role> {
  constructor(
    private readonly rbac: RbacRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: GrantPermissionCommand): Promise<Role> {
    const permissionName = PermissionName.of(command.permissionName);

    return this.uow.withTransaction(async () => {
      const role = await this.rbac.findRoleByUuid(command.roleUuid);

      if (!role) {
        throw RoleNotFound();
      }

      const permission = await this.rbac.findPermissionByName(permissionName);

      if (!permission) {
        throw PermissionNotFound();
      }

      role.grant(permission, command.grantedBy, this.clock.now());
      await this.rbac.saveRole(role);
      await this.events.publishAll(role.pullEvents());

      return role;
    });
  }
}

@CommandHandler(RevokePermissionCommand)
export class RevokePermissionHandler implements ICommandHandler<RevokePermissionCommand, Role> {
  constructor(
    private readonly rbac: RbacRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: RevokePermissionCommand): Promise<Role> {
    const permissionName = PermissionName.of(command.permissionName);

    return this.uow.withTransaction(async () => {
      const role = await this.rbac.findRoleByUuid(command.roleUuid);

      if (!role) {
        throw RoleNotFound();
      }

      role.revoke(permissionName, this.clock.now());
      await this.rbac.saveRole(role);
      await this.events.publishAll(role.pullEvents());

      return role;
    });
  }
}

@CommandHandler(AssignRoleCommand)
export class AssignRoleHandler implements ICommandHandler<AssignRoleCommand, void> {
  constructor(
    private readonly rbac: RbacRepository,
    // Identity's port, from its public index — the same relationship owner and
    // car have with the contexts they reference.
    private readonly users: UserRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: AssignRoleCommand): Promise<void> {
    await this.uow.withTransaction(async () => {
      const role = await this.rbac.findRoleByUuid(command.roleUuid);

      if (!role) {
        throw RoleNotFound();
      }

      // Referential integrity across contexts is checked here, not by a foreign
      // key — user_roles.user_uuid is an id, not a FK (AGENTS.md §13).
      const user = await this.users.findByUuid(command.userUuid);

      if (!user || user.isDeleted) {
        throw AppError.invalid('USER_NOT_FOUND', 'no such user').withField(
          'userUuid',
          'does not exist',
        );
      }

      await this.rbac.assignRole(command.userUuid, role, command.assignedBy, this.clock.now());
      await this.events.publish(
        new RoleAssignedToUser(command.userUuid, role.uuid, role.name.value),
      );
    });
  }
}

@CommandHandler(UnassignRoleCommand)
export class UnassignRoleHandler implements ICommandHandler<UnassignRoleCommand, void> {
  constructor(
    private readonly rbac: RbacRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(command: UnassignRoleCommand): Promise<void> {
    await this.uow.withTransaction(async () => {
      const role = await this.rbac.findRoleByUuid(command.roleUuid);

      if (!role) {
        throw RoleNotFound();
      }

      await this.rbac.unassignRole(command.userUuid, role);
      // Published even when the user did not hold the role. The event means
      // "this user does not hold it now", which is what the cache invalidator
      // acts on, and suppressing it would make the endpoint's effect depend on
      // state the caller cannot see.
      await this.events.publish(
        new RoleUnassignedFromUser(command.userUuid, role.uuid, role.name.value),
      );
    });
  }
}
