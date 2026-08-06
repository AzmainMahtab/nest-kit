import { Email, User, UserRepository } from '../../modules/identity';
import {
  Permission,
  PermissionName,
  RbacRepository,
  Role,
  RoleAssignment,
  RoleName,
} from '../../modules/rbac';
import { Clock, EventBus, Grants, Hasher, UnitOfWork } from '../../shared/application';
import { DomainEvent } from '../../shared/domain';
import { Page, PaginationParams } from '../../shared/pagination';
import { SEED_PERMISSIONS, SEED_ROLES } from './rbac.catalog';
import { RbacSeeder } from './rbac.seeder';
import { SuperAdminSeeder } from './superadmin.seeder';

const NOW = new Date('2026-01-01T00:00:00.000Z');

/** The seeders touch a narrow slice of the port; the rest must never be called. */
function unused(): never {
  throw new Error('not used by the seeders');
}

interface Link {
  userUuid: string;
  roleUuid: string;
  assignedBy: string | null;
}

class FakeRbacRepository extends RbacRepository {
  readonly permissions: Permission[] = [];
  readonly roles: Role[] = [];
  readonly links: Link[] = [];

  findPermissionByName(name: PermissionName): Promise<Permission | null> {
    return Promise.resolve(this.permissions.find((p) => p.name.equals(name)) ?? null);
  }

  findPermissionByUuid(): Promise<Permission | null> {
    return unused();
  }

  listPermissions(): Promise<Page<Permission>> {
    return unused();
  }

  savePermission(permission: Permission): Promise<void> {
    if (!this.permissions.includes(permission)) {
      this.permissions.push(permission);
    }
    return Promise.resolve();
  }

  findRoleByName(name: RoleName): Promise<Role | null> {
    return Promise.resolve(this.roles.find((r) => r.name.equals(name)) ?? null);
  }

  findRoleByUuid(): Promise<Role | null> {
    return unused();
  }

  listRoles(): Promise<Page<Role>> {
    return unused();
  }

  saveRole(role: Role): Promise<void> {
    if (!this.roles.includes(role)) {
      this.roles.push(role);
    }
    return Promise.resolve();
  }

  assignRole(userUuid: string, role: Role, assignedBy: string | null): Promise<void> {
    if (!this.links.some((l) => l.userUuid === userUuid && l.roleUuid === role.uuid)) {
      this.links.push({ userUuid, roleUuid: role.uuid, assignedBy });
    }
    return Promise.resolve();
  }

  unassignRole(): Promise<void> {
    return unused();
  }

  findAssignmentsForUser(userUuid: string): Promise<RoleAssignment[]> {
    return Promise.resolve(
      this.links.flatMap((link) => {
        const role = this.roles.find((r) => r.uuid === link.roleUuid);

        return role && link.userUuid === userUuid
          ? [{ userUuid, role, assignedBy: link.assignedBy, assignedAt: NOW }]
          : [];
      }),
    );
  }

  findUserUuidsForRole(): Promise<string[]> {
    return unused();
  }

  grantsFor(): Promise<Grants> {
    return unused();
  }

  roleNamed(name: string): Role | undefined {
    return this.roles.find((r) => r.name.value === name);
  }
}

class FakeUserRepository extends UserRepository {
  readonly saved: User[] = [];

  findByUuid(): Promise<User | null> {
    return unused();
  }

  findByEmail(email: Email): Promise<User | null> {
    return Promise.resolve(this.saved.find((u) => u.email.equals(email)) ?? null);
  }

  list(params: PaginationParams): Promise<Page<User>> {
    return Promise.resolve(Page.of(this.saved, this.saved.length, params));
  }

  save(user: User): Promise<void> {
    if (!this.saved.includes(user)) {
      this.saved.push(user);
    }
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

  names(): string[] {
    return this.published.map((event) => event.name);
  }
}

class PassThroughUnitOfWork extends UnitOfWork {
  withTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FakeHasher extends Hasher {
  hash(plaintext: string): Promise<string> {
    return Promise.resolve(`hashed:${plaintext}`);
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return Promise.resolve(hash === `hashed:${plaintext}`);
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
    catalogue: new RbacSeeder(rbac, events, uow, clock),
    superadmin: new SuperAdminSeeder(users, rbac, new FakeHasher(), events, uow, clock),
  };
}

describe('RbacSeeder', () => {
  it('creates the whole catalogue on an empty database', async () => {
    const { catalogue, rbac } = build();

    const report = await catalogue.run();

    expect(report.permissionsCreated).toEqual(SEED_PERMISSIONS.map((p) => p.name));
    expect(report.rolesCreated).toEqual(SEED_ROLES.map((r) => r.name));
    expect(rbac.permissions).toHaveLength(SEED_PERMISSIONS.length);
    expect(rbac.roles).toHaveLength(SEED_ROLES.length);
  });

  it('gives admin every permission in the catalogue, and protects it', async () => {
    const { catalogue, rbac } = build();

    await catalogue.run();
    const admin = rbac.roleNamed('admin');

    expect(admin?.isProtected).toBe(true);
    expect([...(admin?.permissionNames ?? [])].sort()).toEqual(
      SEED_PERMISSIONS.map((p) => p.name).sort(),
    );
  });

  it('gives the example roles only their own permission', async () => {
    const { catalogue, rbac } = build();

    await catalogue.run();

    expect(rbac.roleNamed('auditor')?.permissionNames).toEqual(['rbac:read']);
    expect(rbac.roleNamed('messaging-operator')?.permissionNames).toEqual(['messaging:admin']);
    expect(rbac.roleNamed('auditor')?.isProtected).toBe(false);
  });

  it('is a no-op on a second run', async () => {
    const { catalogue, rbac, events } = build();
    await catalogue.run();
    events.published.length = 0;

    const report = await catalogue.run();

    expect(report).toEqual({ permissionsCreated: [], rolesCreated: [], permissionsGranted: [] });
    expect(rbac.permissions).toHaveLength(SEED_PERMISSIONS.length);
    expect(rbac.roles).toHaveLength(SEED_ROLES.length);
    expect(events.published).toHaveLength(0);
  });

  it('extends a role that predates a catalogue entry', async () => {
    const { catalogue, rbac } = build();
    // An `auditor` created by hand, holding nothing yet.
    rbac.roles.push(Role.create(RoleName.of('auditor'), '', NOW));

    const report = await catalogue.run();

    expect(report.rolesCreated).not.toContain('auditor');
    expect(report.permissionsGranted).toContain('auditor -> rbac:read');
    expect(rbac.roleNamed('auditor')?.permissionNames).toEqual(['rbac:read']);
  });

  it('never revokes a permission the catalogue does not list', async () => {
    const { catalogue, rbac } = build();
    const extra = Permission.create(PermissionName.of('billing:refund'), '', NOW);
    const auditor = Role.create(RoleName.of('auditor'), '', NOW);
    auditor.grant(extra, 'an-operator', NOW);
    rbac.permissions.push(extra);
    rbac.roles.push(auditor);

    await catalogue.run();

    // A deploy must not quietly undo what an operator granted by hand.
    expect([...(rbac.roleNamed('auditor')?.permissionNames ?? [])].sort()).toEqual([
      'billing:refund',
      'rbac:read',
    ]);
  });

  it('publishes the grant so a running API evicts cached grants', async () => {
    const { catalogue, events } = build();

    await catalogue.run();

    expect(events.names()).toContain('rbac.role.permission-granted');
    expect(events.names()).toContain('rbac.permission.created');
    expect(events.names()).toContain('rbac.role.created');
  });
});

describe('SuperAdminSeeder', () => {
  const seedThenRun = async (harness: ReturnType<typeof build>) => {
    await harness.catalogue.run();
    harness.events.published.length = 0;
    return harness.superadmin.run('ops@example.com', 'correct-horse-battery');
  };

  it('creates an active administrator holding the admin role', async () => {
    const harness = build();

    const report = await seedThenRun(harness);

    expect(report.userCreated).toBe(true);
    expect(report.roleAssigned).toBe(true);
    expect(harness.users.saved).toHaveLength(1);
    // PENDING would produce an account nobody can use until someone activates it.
    expect(harness.users.saved[0]?.status).toBe('ACTIVE');
    expect(harness.users.saved[0]?.passwordHash).toBe('hashed:correct-horse-battery');
    expect(harness.rbac.links).toHaveLength(1);
    expect(harness.rbac.links[0]?.assignedBy).toBeNull();
  });

  it('does not announce a registration nobody made', async () => {
    const harness = build();

    await seedThenRun(harness);

    // A durable consumer reacts to this by mailing a welcome notification.
    expect(harness.events.names()).not.toContain('identity.user.registered');
    expect(harness.events.names()).toEqual(['rbac.role.assigned']);
  });

  it('reuses an existing account instead of resetting its password', async () => {
    const harness = build();
    await seedThenRun(harness);
    const original = harness.users.saved[0]?.passwordHash;

    const report = await harness.superadmin.run('ops@example.com', 'a-different-password');

    expect(report.userCreated).toBe(false);
    expect(harness.users.saved).toHaveLength(1);
    expect(harness.users.saved[0]?.passwordHash).toBe(original);
  });

  it('is a no-op on a second run', async () => {
    const harness = build();
    await seedThenRun(harness);
    harness.events.published.length = 0;

    const report = await harness.superadmin.run('ops@example.com', 'correct-horse-battery');

    expect(report).toMatchObject({ userCreated: false, roleAssigned: false });
    expect(harness.rbac.links).toHaveLength(1);
    expect(harness.events.published).toHaveLength(0);
  });

  it('refuses to run before the catalogue exists', async () => {
    const { superadmin } = build();

    await expect(superadmin.run('ops@example.com', 'correct-horse-battery')).rejects.toThrow(
      /no 'admin' role/,
    );
  });

  it('rejects a malformed address before writing anything', async () => {
    const harness = build();
    await harness.catalogue.run();

    await expect(harness.superadmin.run('not-an-email', 'correct-horse-battery')).rejects.toThrow();
    expect(harness.users.saved).toHaveLength(0);
  });
});
