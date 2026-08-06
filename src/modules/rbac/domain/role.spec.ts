import { AppError } from '../../../shared/errors';
import { Permission } from './permission';
import { Role } from './role';
import { PermissionName } from './value-objects/permission-name';
import { RoleName } from './value-objects/role-name';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-02T00:00:00.000Z');

const permission = (name: string) => Permission.create(PermissionName.of(name), '', NOW);

const role = (name = 'support-agent') => {
  const created = Role.create(RoleName.of(name), 'Handles tickets', NOW);
  created.pullEvents();
  return created;
};

const protectedRole = (grants: readonly Permission[]) =>
  Role.fromSnapshot({
    uuid: 'role-uuid',
    name: RoleName.of('admin'),
    description: '',
    isProtected: true,
    grants: grants.map((permission) => ({ permission, grantedBy: null, grantedAt: NOW })),
    createdAt: NOW,
    updatedAt: NOW,
  });

describe('Role', () => {
  it('records its creation', () => {
    const created = Role.create(RoleName.of('support-agent'), '', NOW);

    expect(created.pullEvents()).toMatchObject([
      { name: 'rbac.role.created', roleUuid: created.uuid, roleName: 'support-agent' },
    ]);
  });

  it('grants a permission with its audit trail', () => {
    const subject = role();

    subject.grant(permission('billing:refund'), 'admin-uuid', LATER);

    expect(subject.permissionNames).toEqual(['billing:refund']);
    expect(subject.grants[0]).toMatchObject({ grantedBy: 'admin-uuid', grantedAt: LATER });
    expect(subject.pullEvents()).toMatchObject([
      { name: 'rbac.role.permission-granted', permissionName: 'billing:refund' },
    ]);
  });

  it('treats a repeated grant as a no-op so a re-run cannot fail', () => {
    const subject = role();
    subject.grant(permission('billing:refund'), 'first-admin', NOW);
    subject.pullEvents();

    subject.grant(permission('billing:refund'), 'second-admin', LATER);

    expect(subject.permissionNames).toEqual(['billing:refund']);
    // The original audit row survives — the second call did not overwrite it.
    expect(subject.grants[0]).toMatchObject({ grantedBy: 'first-admin', grantedAt: NOW });
    expect(subject.pullEvents()).toHaveLength(0);
  });

  it('revokes a permission it holds', () => {
    const subject = role();
    subject.grant(permission('billing:refund'), null, NOW);
    subject.pullEvents();

    subject.revoke(PermissionName.of('billing:refund'), LATER);

    expect(subject.permissionNames).toEqual([]);
    expect(subject.pullEvents()).toMatchObject([
      { name: 'rbac.role.permission-revoked', permissionName: 'billing:refund' },
    ]);
  });

  it('treats revoking what it does not hold as a no-op', () => {
    const subject = role();

    subject.revoke(PermissionName.of('billing:refund'), LATER);

    expect(subject.pullEvents()).toHaveLength(0);
  });

  it('refuses to revoke from a protected role, so admin cannot lock itself out', () => {
    const admin = protectedRole([permission('rbac:admin')]);

    expect(() => admin.revoke(PermissionName.of('rbac:admin'), LATER)).toThrow(AppError);
    expect(admin.permissionNames).toEqual(['rbac:admin']);
  });

  it('still lets a protected role gain a permission, so the seed can extend it', () => {
    // The asymmetry is deliberate: lockout comes from losing rbac:admin, never
    // from gaining something. Forbidding grants would freeze `admin` at
    // whatever the catalogue held the day it was created.
    const admin = protectedRole([]);

    admin.grant(permission('billing:refund'), null, LATER);

    expect(admin.permissionNames).toEqual(['billing:refund']);
  });

  it('marks a role created via createProtected', () => {
    const admin = Role.createProtected(RoleName.of('admin'), 'Full access', NOW);

    expect(admin.isProtected).toBe(true);
    expect(admin.pullEvents()).toMatchObject([{ name: 'rbac.role.created', roleName: 'admin' }]);
  });

  it('leaves a role created via create unprotected', () => {
    expect(Role.create(RoleName.of('auditor'), '', NOW).isProtected).toBe(false);
  });

  it('clears its events once pulled so a re-save cannot re-emit', () => {
    const subject = role();
    subject.grant(permission('billing:refund'), null, LATER);

    expect(subject.pullEvents()).toHaveLength(1);
    expect(subject.pullEvents()).toHaveLength(0);
  });
});
