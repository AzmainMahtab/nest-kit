import { AppError } from '../../../shared/errors';
import { User } from './user';
import { UserStatus } from './user-status';
import { Email } from './value-objects/email';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-02T00:00:00.000Z');

function aUser(): User {
  return User.register(Email.of('ada@example.com'), 'hash', NOW);
}

describe('User', () => {
  it('registers as pending and records the event', () => {
    const user = aUser();

    expect(user.status).toBe(UserStatus.Pending);
    expect(user.isDeleted).toBe(false);
    expect(user.pullEvents().map((e) => e.name)).toEqual(['identity.user.registered']);
  });

  it('drains events so a re-save cannot re-emit them', () => {
    const user = aUser();

    expect(user.pullEvents()).toHaveLength(1);
    expect(user.pullEvents()).toHaveLength(0);
  });

  it('records nothing when rehydrated from persistence', () => {
    const user = User.fromSnapshot({
      uuid: 'u-1',
      email: Email.of('ada@example.com'),
      passwordHash: 'hash',
      status: UserStatus.Active,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });

    expect(user.pullEvents()).toHaveLength(0);
  });

  it('emits nothing when the email is unchanged', () => {
    const user = aUser();
    user.pullEvents();

    user.changeEmail(Email.of('ADA@example.com'), LATER);

    expect(user.pullEvents()).toHaveLength(0);
    expect(user.updatedAt).toEqual(NOW);
  });

  it('records the old and new address on a real change', () => {
    const user = aUser();
    user.pullEvents();

    user.changeEmail(Email.of('grace@example.com'), LATER);

    expect(user.email.value).toBe('grace@example.com');
    expect(user.updatedAt).toEqual(LATER);
    expect(user.pullEvents()).toMatchObject([
      { name: 'identity.user.email-changed', oldEmail: 'ada@example.com' },
    ]);
  });

  it('refuses to drift a suspended account back to pending', () => {
    const user = aUser();
    user.changeStatus(UserStatus.Suspended, LATER);

    expect(() => user.changeStatus(UserStatus.Pending, LATER)).toThrow(AppError);
  });

  it('allows a suspended account to be reinstated explicitly', () => {
    const user = aUser();
    user.changeStatus(UserStatus.Suspended, LATER);
    user.pullEvents();

    user.changeStatus(UserStatus.Active, LATER);

    expect(user.status).toBe(UserStatus.Active);
  });

  it('refuses every mutation once deleted', () => {
    const user = aUser();
    user.delete(LATER);

    expect(user.isDeleted).toBe(true);
    expect(() => user.delete(LATER)).toThrow(AppError);
    expect(() => user.changeEmail(Email.of('grace@example.com'), LATER)).toThrow(AppError);
    expect(() => user.changeStatus(UserStatus.Active, LATER)).toThrow(AppError);
  });
});
