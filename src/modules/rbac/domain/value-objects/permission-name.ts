import { InvalidPermissionName } from '../errors';

const SEGMENT = /^[a-z][a-z0-9-]*$/;

/**
 * A permission name in `resource:action` form — `user:create`, `messaging:admin`.
 *
 * The two halves are kept as fields rather than parsed on demand because
 * "every permission on this resource" is a query the admin UI runs, and
 * splitting the string at every call site is how the halves drift.
 *
 * Lowercase is enforced rather than normalised: `User:Create` and `user:create`
 * arriving as two rows is a silent authorization hole, so the boundary rejects
 * the ambiguity instead of guessing.
 */
export class PermissionName {
  private constructor(
    readonly resource: string,
    readonly action: string,
  ) {}

  static of(raw: string): PermissionName {
    const [resource, action, ...rest] = raw.trim().split(':');

    if (resource === undefined || action === undefined || rest.length > 0) {
      throw InvalidPermissionName(raw);
    }

    if (!SEGMENT.test(resource) || !SEGMENT.test(action)) {
      throw InvalidPermissionName(raw);
    }

    return new PermissionName(resource, action);
  }

  get value(): string {
    return `${this.resource}:${this.action}`;
  }

  equals(other: PermissionName): boolean {
    return this.value === other.value;
  }
}
