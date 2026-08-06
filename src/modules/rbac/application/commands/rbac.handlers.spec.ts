import { Email, User, UserRepository } from '../../../identity';
import { Clock, EventBus, Grants, UnitOfWork } from '../../../../shared/application';
import { DomainEvent } from '../../../../shared/domain';
import { AppError } from '../../../../shared/errors';
import { Page, PaginationParams } from '../../../../shared/pagination';
import { Permission } from '../../domain/permission';
import { RbacRepository } from '../../domain/ports/rbac-repository.port';
import { Role } from '../../domain/role';
import { RoleAssignment } from '../../domain/role-assignment';
import { PermissionName } from '../../domain/value-objects/permission-name';
import { RoleName } from '../../domain/value-objects/role-name';
import {
  AssignRoleCommand,
  CreateRoleCommand,
  GrantPermissionCommand,
  RevokePermissionCommand,
  UnassignRoleCommand,
} from './rbac.commands';
import {
  AssignRoleHandler,
  CreateRoleHandler,
  GrantPermissionHandler,
  RevokePermissionHandler,
  UnassignRoleHandler,
} from './rbac.handlers';

const NOW = new Date('2026-01-01T00:00:00.000Z');

interface Link {
  userUuid: string;
  roleUuid: string;
  assignedBy: string | null;
  assignedAt: Date;
}

class FakeRbacRepository extends RbacRepository {
  readonly permissions: Permission[] = [];
  readonly roles: Role[] = [];
  readonly links: Link[] = [];

  findPermissionByName(name: PermissionName): Promise<Permission | null> {
    return Promise.resolve(this.permissions.find((p) => p.name.equals(name)) ?? null);
  }

  findPermissionByUuid(uuid: string): Promise<Permission | null> {
    return Promise.resolve(this.permissions.find((p) => p.uuid === uuid) ?? null);
  }

  listPermissions(params: PaginationParams): Promise<Page<Permission>> {
    return Promise.resolve(Page.of(this.permissions, this.permissions.length, params));
  }

  savePermission(permission: Permission): Promise<void> {
    this.permissions.push(permission);
    return Promise.resolve();
  }

  findRoleByName(name: RoleName): Promise<Role | null> {
    return Promise.resolve(this.roles.find((r) => r.name.equals(name)) ?? null);
  }

  findRoleByUuid(uuid: string): Promise<Role | null> {
    return Promise.resolve(this.roles.find((r) => r.uuid === uuid) ?? null);
  }

  listRoles(params: PaginationParams): Promise<Page<Role>> {
    return Promise.resolve(Page.of(this.roles, this.roles.length, params));
  }

  saveRole(role: Role): Promise<void> {
    if (!this.roles.includes(role)) {
      this.roles.push(role);
    }
    return Promise.resolve();
  }

  assignRole(userUuid: string, role: Role, assignedBy: string | null, now: Date): Promise<void> {
    // Mirrors the ON CONFLICT DO NOTHING in the adapter.
    if (!this.links.some((l) => l.userUuid === userUuid && l.roleUuid === role.uuid)) {
      this.links.push({ userUuid, roleUuid: role.uuid, assignedBy, assignedAt: now });
    }
    return Promise.resolve();
  }

  unassignRole(userUuid: string, role: Role): Promise<void> {
    const index = this.links.findIndex((l) => l.userUuid === userUuid && l.roleUuid === role.uuid);

    if (index !== -1) {
      this.links.splice(index, 1);
    }

    return Promise.resolve();
  }

  findAssignmentsForUser(userUuid: string): Promise<RoleAssignment[]> {
    return Promise.resolve(
      this.links.flatMap((link) => {
        const role = this.roles.find((r) => r.uuid === link.roleUuid);

        return role && link.userUuid === userUuid
          ? [{ userUuid, role, assignedBy: link.assignedBy, assignedAt: link.assignedAt }]
          : [];
      }),
    );
  }

  findUserUuidsForRole(roleUuid: string): Promise<string[]> {
    return Promise.resolve(
      this.links.filter((l) => l.roleUuid === roleUuid).map((l) => l.userUuid),
    );
  }

  grantsFor(userUuid: string): Promise<Grants> {
    const roles = this.links
      .filter((l) => l.userUuid === userUuid)
      .flatMap((l) => this.roles.filter((r) => r.uuid === l.roleUuid));

    return Promise.resolve({
      roles: roles.map((r) => r.name.value),
      permissions: [...new Set(roles.flatMap((r) => r.permissionNames))],
    });
  }
}

class FakeUserRepository extends UserRepository {
  readonly saved: User[] = [];

  findByUuid(uuid: string): Promise<User | null> {
    return Promise.resolve(this.saved.find((u) => u.uuid === uuid) ?? null);
  }

  findByEmail(email: Email): Promise<User | null> {
    return Promise.resolve(this.saved.find((u) => !u.isDeleted && u.email.equals(email)) ?? null);
  }

  list(params: PaginationParams): Promise<Page<User>> {
    return Promise.resolve(Page.of(this.saved, this.saved.length, params));
  }

  save(user: User): Promise<void> {
    this.saved.push(user);
    return Promise.resolve();
  }
}

class RecordingEventBus extends EventBus {
  readonly published: DomainEvent[] = [];

  publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
    return Promise.resolve();
  }

  publishAll(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    return Promise.resolve();
  }
}

class PassThroughUnitOfWork extends UnitOfWork {
  withTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FixedClock extends Clock {
  now(): Date {
    return NOW;
  }
}

function build() {
  const rbac = new FakeRbacRepository();
  const users = new FakeUserRepository();
  const events = new RecordingEventBus();
  const uow = new PassThroughUnitOfWork();
  const clock = new FixedClock();

  return {
    rbac,
    users,
    events,
    createRole: new CreateRoleHandler(rbac, events, uow, clock),
    grant: new GrantPermissionHandler(rbac, events, uow, clock),
    revoke: new RevokePermissionHandler(rbac, events, uow, clock),
    assign: new AssignRoleHandler(rbac, users, events, uow, clock),
    unassign: new UnassignRoleHandler(rbac, events, uow),
  };
}

function seedRole(rbac: FakeRbacRepository, name = 'support-agent'): Role {
  const role = Role.create(RoleName.of(name), '', NOW);
  role.pullEvents();
  rbac.roles.push(role);
  return role;
}

function seedPermission(rbac: FakeRbacRepository, name = 'billing:refund'): Permission {
  const permission = Permission.create(PermissionName.of(name), '', NOW);
  permission.pullEvents();
  rbac.permissions.push(permission);
  return permission;
}

function seedUser(users: FakeUserRepository, email = 'ada@example.com'): User {
  const user = User.register(Email.of(email), 'hash', NOW);
  user.pullEvents();
  users.saved.push(user);
  return user;
}

describe('CreateRoleHandler', () => {
  it('rejects a duplicate name with a domain error', async () => {
    const { createRole, rbac } = build();
    seedRole(rbac, 'support-agent');

    await expect(
      createRole.execute(new CreateRoleCommand('support-agent', '')),
    ).rejects.toMatchObject({ code: 'ROLE_ALREADY_EXISTS' });
  });

  it('rejects a malformed name before touching the repository', async () => {
    const { createRole, rbac } = build();

    await expect(createRole.execute(new CreateRoleCommand('Support Agent', ''))).rejects.toThrow(
      AppError,
    );
    expect(rbac.roles).toHaveLength(0);
  });
});

describe('GrantPermissionHandler', () => {
  it('grants and publishes the change', async () => {
    const { grant, rbac, events } = build();
    const role = seedRole(rbac);
    seedPermission(rbac);

    const updated = await grant.execute(
      new GrantPermissionCommand(role.uuid, 'billing:refund', 'admin-uuid'),
    );

    expect(updated.permissionNames).toEqual(['billing:refund']);
    expect(events.published).toMatchObject([
      { name: 'rbac.role.permission-granted', roleUuid: role.uuid },
    ]);
  });

  it('fails when the role does not exist', async () => {
    const { grant, rbac } = build();
    seedPermission(rbac);

    await expect(
      grant.execute(new GrantPermissionCommand('missing', 'billing:refund', null)),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });

  it('fails when the permission is not in the catalogue', async () => {
    const { grant, rbac } = build();
    const role = seedRole(rbac);

    await expect(
      grant.execute(new GrantPermissionCommand(role.uuid, 'billing:refund', null)),
    ).rejects.toMatchObject({ code: 'PERMISSION_NOT_FOUND' });
  });

  it('publishes nothing when the grant fails', async () => {
    const { grant, rbac, events } = build();
    const role = seedRole(rbac);

    await expect(
      grant.execute(new GrantPermissionCommand(role.uuid, 'billing:refund', null)),
    ).rejects.toThrow(AppError);
    expect(events.published).toHaveLength(0);
  });
});

describe('RevokePermissionHandler', () => {
  it('publishes nothing when the role never held the permission', async () => {
    const { revoke, rbac, events } = build();
    const role = seedRole(rbac);

    await revoke.execute(new RevokePermissionCommand(role.uuid, 'billing:refund'));

    expect(events.published).toHaveLength(0);
  });
});

describe('AssignRoleHandler', () => {
  it('links the user and publishes the assignment', async () => {
    const { assign, rbac, users, events } = build();
    const role = seedRole(rbac);
    const user = seedUser(users);

    await assign.execute(new AssignRoleCommand(user.uuid, role.uuid, 'admin-uuid'));

    expect(rbac.links).toMatchObject([
      { userUuid: user.uuid, roleUuid: role.uuid, assignedBy: 'admin-uuid' },
    ]);
    expect(events.published).toMatchObject([
      { name: 'rbac.role.assigned', userUuid: user.uuid, roleName: 'support-agent' },
    ]);
  });

  it('keeps the original audit row when the role is assigned twice', async () => {
    const { assign, rbac, users } = build();
    const role = seedRole(rbac);
    const user = seedUser(users);

    await assign.execute(new AssignRoleCommand(user.uuid, role.uuid, 'first-admin'));
    await assign.execute(new AssignRoleCommand(user.uuid, role.uuid, 'second-admin'));

    expect(rbac.links).toHaveLength(1);
    expect(rbac.links[0]?.assignedBy).toBe('first-admin');
  });

  it('rejects an unknown user rather than creating a dangling assignment', async () => {
    const { assign, rbac } = build();
    const role = seedRole(rbac);

    await expect(
      assign.execute(new AssignRoleCommand('no-such-user', role.uuid, null)),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(rbac.links).toHaveLength(0);
  });

  it('rejects a soft-deleted user', async () => {
    const { assign, rbac, users } = build();
    const role = seedRole(rbac);
    const user = seedUser(users);
    user.delete(NOW);

    await expect(
      assign.execute(new AssignRoleCommand(user.uuid, role.uuid, null)),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('fails when the role does not exist', async () => {
    const { assign, users } = build();
    const user = seedUser(users);

    await expect(
      assign.execute(new AssignRoleCommand(user.uuid, 'missing', null)),
    ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });
});

describe('UnassignRoleHandler', () => {
  it('removes the link and publishes', async () => {
    const { assign, unassign, rbac, users, events } = build();
    const role = seedRole(rbac);
    const user = seedUser(users);
    await assign.execute(new AssignRoleCommand(user.uuid, role.uuid, null));
    events.published.length = 0;

    await unassign.execute(new UnassignRoleCommand(user.uuid, role.uuid));

    expect(rbac.links).toHaveLength(0);
    expect(events.published).toMatchObject([{ name: 'rbac.role.unassigned', userUuid: user.uuid }]);
  });

  it('publishes even when the user did not hold the role, so the cache is evicted either way', async () => {
    const { unassign, rbac, users, events } = build();
    const role = seedRole(rbac);
    const user = seedUser(users);

    await unassign.execute(new UnassignRoleCommand(user.uuid, role.uuid));

    expect(events.published).toMatchObject([{ name: 'rbac.role.unassigned' }]);
  });
});
