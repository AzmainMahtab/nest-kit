import { Role } from './role';

/**
 * A role held by a user, with the audit trail of who assigned it.
 *
 * Not part of the {@link Role} aggregate: the set of users holding a role is
 * unbounded, and loading it to grant one permission would read a table to write
 * a row.
 */
export interface RoleAssignment {
  readonly userUuid: string;
  readonly role: Role;
  readonly assignedBy: string | null;
  readonly assignedAt: Date;
}
