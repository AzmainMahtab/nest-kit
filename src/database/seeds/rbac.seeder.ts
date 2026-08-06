import { Permission, PermissionName, RbacRepository, Role, RoleName } from '../../modules/rbac';
import { Clock, EventBus, UnitOfWork } from '../../shared/application';
import { SEED_PERMISSIONS, SEED_ROLES } from './rbac.catalog';

export interface RbacSeedReport {
  permissionsCreated: string[];
  rolesCreated: string[];
  permissionsGranted: string[];
}

/**
 * Reconciles the database to {@link SEED_PERMISSIONS} and {@link SEED_ROLES}.
 *
 * A plain class, constructed by the seed script from the application context —
 * the same reasoning that keeps use cases free of `Test.createTestingModule`.
 * It is not a provider, so nothing in the running application can invoke it by
 * accident.
 *
 * **Additive only.** The seed grants what the catalogue lists and never revokes
 * what it does not. A role an operator has extended by hand must not be quietly
 * stripped by the next deploy, and removing a permission is a decision with a
 * blast radius that belongs in a migration, where it is reviewed.
 *
 * Idempotent throughout: `grant` is a no-op for a permission already held, so a
 * second run reports nothing and writes nothing.
 */
export class RbacSeeder {
  constructor(
    private readonly rbac: RbacRepository,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<RbacSeedReport> {
    const report: RbacSeedReport = {
      permissionsCreated: [],
      rolesCreated: [],
      permissionsGranted: [],
    };

    await this.uow.withTransaction(async () => {
      const catalogue = await this.seedPermissions(report);
      await this.seedRoles(catalogue, report);
    });

    return report;
  }

  private async seedPermissions(report: RbacSeedReport): Promise<Map<string, Permission>> {
    const catalogue = new Map<string, Permission>();

    for (const wanted of SEED_PERMISSIONS) {
      const name = PermissionName.of(wanted.name);
      const existing = await this.rbac.findPermissionByName(name);

      if (existing) {
        catalogue.set(wanted.name, existing);
        continue;
      }

      const created = Permission.create(name, wanted.description, this.clock.now());
      await this.rbac.savePermission(created);
      await this.events.publishAll(created.pullEvents());

      catalogue.set(wanted.name, created);
      report.permissionsCreated.push(wanted.name);
    }

    return catalogue;
  }

  private async seedRoles(
    catalogue: Map<string, Permission>,
    report: RbacSeedReport,
  ): Promise<void> {
    const now = this.clock.now();

    for (const wanted of SEED_ROLES) {
      const name = RoleName.of(wanted.name);
      let role = await this.rbac.findRoleByName(name);

      if (!role) {
        role = wanted.isProtected
          ? Role.createProtected(name, wanted.description, now)
          : Role.create(name, wanted.description, now);
        report.rolesCreated.push(wanted.name);
      }

      for (const permissionName of wanted.permissions) {
        const permission = catalogue.get(permissionName);

        // Unreachable while every role's permissions come from the same
        // catalogue, but a typo in a hand-edited SEED_ROLES entry would
        // otherwise grant nothing and say nothing.
        if (!permission) {
          throw new Error(
            `role '${wanted.name}' wants '${permissionName}', which is not in SEED_PERMISSIONS`,
          );
        }

        if (!role.holds(permission.name)) {
          report.permissionsGranted.push(`${wanted.name} -> ${permissionName}`);
        }

        // assignedBy is null: the catalogue granted this, not a person.
        role.grant(permission, null, now);
      }

      await this.rbac.saveRole(role);
      // Carries the invalidation for every holder of the role, so a running API
      // picks up a widened role without waiting for the cache to expire.
      await this.events.publishAll(role.pullEvents());
    }
  }
}
