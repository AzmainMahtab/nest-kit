import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { Email, UserRepository } from '../../identity';
import { AppConfig } from '../../../platform/config';
import { AssignRoleCommand } from '../application/commands/rbac.commands';
import { RbacRepository } from '../domain/ports/rbac-repository.port';
import { RoleName } from '../domain/value-objects/role-name';

/** Seeded by the migration; the only role that starts out holding `rbac:admin`. */
const ADMIN_ROLE = 'admin';

/**
 * Grants the `admin` role to a named user on boot.
 *
 * Something has to break the circularity: assigning a role requires
 * `rbac:admin`, which is only reachable through a role somebody already holds.
 * The alternative — a hand-written INSERT documented in a README — is a step
 * that gets skipped, and a fresh environment then has no way in at all.
 *
 * Idempotent in both directions: the assignment is `ON CONFLICT DO NOTHING`, so
 * a restart re-grants nothing and leaves the original audit row alone, and an
 * empty `RBAC_BOOTSTRAP_ADMIN_EMAIL` skips the whole thing.
 */
@Injectable()
export class RbacBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacBootstrap.name);

  constructor(
    private readonly config: AppConfig,
    private readonly users: UserRepository,
    private readonly rbac: RbacRepository,
    private readonly commands: CommandBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.rbac.bootstrapAdminEmail;

    if (!email) {
      return;
    }

    // Logged and swallowed rather than thrown. A misconfigured bootstrap must
    // not take the API down — the same reasoning that keeps a consumer that
    // cannot start from stopping the process (AGENTS.md §7).
    try {
      await this.grantAdmin(email);
    } catch (error) {
      this.logger.error(
        `admin bootstrap failed for '${email}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async grantAdmin(email: string): Promise<void> {
    const user = await this.users.findByEmail(Email.of(email));

    if (!user) {
      // Ordinary on a fresh database: the operator registers the account, then
      // restarts. Warn rather than error so it does not read as a failure.
      this.logger.warn(`admin bootstrap: no user '${email}' yet — register it and restart`);
      return;
    }

    const role = await this.rbac.findRoleByName(RoleName.of(ADMIN_ROLE));

    if (!role) {
      this.logger.error(`admin bootstrap: no '${ADMIN_ROLE}' role — has make migrate-up run?`);
      return;
    }

    // assignedBy is null: nobody granted this, the configuration did.
    await this.commands.execute(new AssignRoleCommand(user.uuid, role.uuid, null));
    this.logger.log(`admin bootstrap: '${email}' holds '${ADMIN_ROLE}'`);
  }
}
