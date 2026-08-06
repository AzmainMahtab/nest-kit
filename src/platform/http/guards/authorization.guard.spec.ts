import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AccessControl, Grants } from '../../../shared/application';
import { CURRENT_USER_KEY, CurrentUser } from '../../../shared/auth-context';
import { AppError } from '../../../shared/errors';
import { RequirePermissions, RequireRoles } from '../decorators/authorize.decorator';
import { AuthorizationGuard } from './authorization.guard';

class FakeAccessControl extends AccessControl {
  calls = 0;

  constructor(private readonly grants: Grants) {
    super();
  }

  grantsFor(): Promise<Grants> {
    this.calls += 1;
    return Promise.resolve(this.grants);
  }
}

/**
 * A real controller shape decorated with the real decorators, read back through
 * a real `Reflector`. Stubbing the reflector would test the guard against
 * metadata keys the decorators might not actually write.
 */
class Routes {
  @RequirePermissions('messaging:admin')
  needsPermission(this: void): void {}

  @RequirePermissions('rbac:read', 'rbac:admin')
  needsEitherPermission(this: void): void {}

  @RequireRoles('admin')
  needsRole(this: void): void {}

  unguarded(this: void): void {}
}

const CALLER: CurrentUser = {
  uuid: 'user-uuid',
  sessionUuid: 'session-uuid',
  jti: 'jti',
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
};

function contextFor(handler: () => void, caller: CurrentUser | undefined): ExecutionContext {
  const request = caller ? { [CURRENT_USER_KEY]: caller } : {};

  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function build(grants: Partial<Grants> = {}) {
  const access = new FakeAccessControl({
    roles: grants.roles ?? [],
    permissions: grants.permissions ?? [],
  });

  return { guard: new AuthorizationGuard(new Reflector(), access), access };
}

describe('AuthorizationGuard', () => {
  it('allows a caller holding the required permission', async () => {
    const { guard } = build({ permissions: ['messaging:admin'] });

    await expect(
      guard.canActivate(contextFor(Routes.prototype.needsPermission, CALLER)),
    ).resolves.toBe(true);
  });

  it('allows a caller holding any one of several required permissions', async () => {
    const { guard } = build({ permissions: ['rbac:admin'] });

    await expect(
      guard.canActivate(contextFor(Routes.prototype.needsEitherPermission, CALLER)),
    ).resolves.toBe(true);
  });

  it('allows a caller holding the required role', async () => {
    const { guard } = build({ roles: ['admin'] });

    await expect(guard.canActivate(contextFor(Routes.prototype.needsRole, CALLER))).resolves.toBe(
      true,
    );
  });

  it('forbids a caller holding an unrelated permission', async () => {
    const { guard } = build({ permissions: ['billing:refund'], roles: ['support-agent'] });

    await expect(
      guard.canActivate(contextFor(Routes.prototype.needsPermission, CALLER)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('forbids a caller with no grants at all', async () => {
    const { guard } = build();

    await expect(
      guard.canActivate(contextFor(Routes.prototype.needsPermission, CALLER)),
    ).rejects.toThrow(AppError);
  });

  it('does not confuse a role name with a permission name', async () => {
    // Holding the `admin` *role* must not satisfy a route that asks for a
    // permission, and vice versa — the two namespaces are separate.
    const { guard } = build({ roles: ['messaging:admin'] });

    await expect(
      guard.canActivate(contextFor(Routes.prototype.needsPermission, CALLER)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an unauthenticated request rather than treating it as ungranted', async () => {
    const { guard } = build({ permissions: ['messaging:admin'] });

    await expect(
      guard.canActivate(contextFor(Routes.prototype.needsPermission, undefined)),
    ).rejects.toMatchObject({ code: 'MISSING_TOKEN' });
  });

  it('allows a route that declares no requirement, without a lookup', async () => {
    const { guard, access } = build();

    await expect(guard.canActivate(contextFor(Routes.prototype.unguarded, CALLER))).resolves.toBe(
      true,
    );
    expect(access.calls).toBe(0);
  });
});
