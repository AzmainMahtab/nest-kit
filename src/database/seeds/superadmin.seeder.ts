import { Email, User, UserRepository, UserStatus } from '../../modules/identity';
import { RbacRepository, RoleAssignedToUser, RoleName } from '../../modules/rbac';
import { Clock, EventBus, Hasher, UnitOfWork } from '../../shared/application';
import { ADMIN_ROLE_NAME } from './rbac.catalog';

export interface SuperAdminSeedReport {
  userUuid: string;
  userCreated: boolean;
  roleAssigned: boolean;
}

/**
 * Creates the first administrator and gives them the `admin` role.
 *
 * Something has to break the circularity: every route that could assign a role
 * requires `rbac:admin`, which only `admin` holds, so a fresh database has no
 * way in. Doing it here rather than on boot means provisioning is an explicit
 * act with an audit trail in the shell history, and that starting the API never
 * writes data — which also removes the race where every replica raced to do it.
 *
 * Idempotent: an existing account is reused rather than rewritten, so a second
 * run never resets a password that has since been changed.
 */
export class SuperAdminSeeder {
  constructor(
    private readonly users: UserRepository,
    private readonly rbac: RbacRepository,
    private readonly hasher: Hasher,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async run(rawEmail: string, password: string): Promise<SuperAdminSeedReport> {
    const email = Email.of(rawEmail);

    return this.uow.withTransaction(async () => {
      const role = await this.rbac.findRoleByName(RoleName.of(ADMIN_ROLE_NAME));

      if (!role) {
        throw new Error(
          `no '${ADMIN_ROLE_NAME}' role — run the rbac seed first, or apply migrations`,
        );
      }

      const existing = await this.users.findByEmail(email);
      const user = existing ?? (await this.create(email, password));

      const held = await this.rbac.findAssignmentsForUser(user.uuid);
      const roleAssigned = !held.some((assignment) => assignment.role.uuid === role.uuid);

      // assignedBy is null: configuration granted this, not a person.
      await this.rbac.assignRole(user.uuid, role, null, this.clock.now());

      if (roleAssigned) {
        // Published so a running API evicts this user's cached grants. The
        // assignment is idempotent, but the event is only worth emitting when
        // something actually changed.
        await this.events.publish(new RoleAssignedToUser(user.uuid, role.uuid, role.name.value));
      }

      return { userUuid: user.uuid, userCreated: existing === null, roleAssigned };
    });
  }

  private async create(email: Email, password: string): Promise<User> {
    const now = this.clock.now();
    const user = User.register(email, await this.hasher.hash(password), now);

    // Registration leaves a user PENDING, which is right for someone who has to
    // confirm an address. A provisioned administrator has nothing to confirm,
    // and shipping them PENDING would make the seed produce an account that
    // cannot be used until someone else activates it.
    user.changeStatus(UserStatus.Active, now);
    await this.users.save(user);

    // Deliberately dropped rather than published. `identity.user.registered`
    // means a person signed up, and a durable consumer reacts to it by queueing
    // a welcome notification — to an operations address that may not receive
    // mail, for an account nobody registered.
    user.pullEvents();

    return user;
  }
}
