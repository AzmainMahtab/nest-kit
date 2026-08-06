import { InvalidRoleName } from '../errors';

const PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * A role name — `admin`, `support-agent`.
 *
 * Same reasoning as {@link PermissionName}: case is rejected rather than folded,
 * because `Admin` and `admin` existing as two rows would split a grant in half
 * without anything failing.
 */
export class RoleName {
  private constructor(readonly value: string) {}

  static of(raw: string): RoleName {
    const value = raw.trim();

    if (!PATTERN.test(value)) {
      throw InvalidRoleName(raw);
    }

    return new RoleName(value);
  }

  equals(other: RoleName): boolean {
    return this.value === other.value;
  }
}
