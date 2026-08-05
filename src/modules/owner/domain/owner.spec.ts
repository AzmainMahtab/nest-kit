import { AppError } from '../../../shared/errors';
import { Owner, OwnerStatus } from './owner';
import { DateOfBirth } from './value-objects/date-of-birth';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-02-01T00:00:00.000Z');
const DOB = () => DateOfBirth.of('1990-04-12', NOW);

const anOwner = () => Owner.register('user-1', '12 Cedar Road, Leeds', DOB(), NOW);

describe('DateOfBirth', () => {
  it('computes age from the calendar, not from milliseconds', () => {
    expect(DateOfBirth.of('1990-04-12', NOW).ageAt(NOW)).toBe(35);
    // Birthday not yet reached this year.
    expect(DateOfBirth.of('1990-12-31', NOW).ageAt(NOW)).toBe(35);
  });

  it('rejects an owner under 18', () => {
    expect(() => DateOfBirth.of('2015-01-01', NOW)).toThrow(AppError);
  });

  it.each([['2030-01-01'], ['not-a-date'], ['1800-01-01']])('rejects %p', (raw) => {
    expect(() => DateOfBirth.of(raw, NOW)).toThrow(AppError);
  });

  it('loads a persisted value without re-checking the rule', () => {
    // A row written before the rule existed must still load.
    expect(DateOfBirth.fromPersistence(new Date('2015-01-01')).toISODate()).toBe('2015-01-01');
  });
});

describe('Owner', () => {
  it('registers active and records the event', () => {
    const owner = anOwner();

    expect(owner.status).toBe(OwnerStatus.Active);
    expect(owner.pullEvents().map((e) => e.name)).toEqual(['owner.owner.registered']);
  });

  it('collapses whitespace in the address', () => {
    const owner = Owner.register('user-1', '  12   Cedar  Road ', DOB(), NOW);

    expect(owner.address).toBe('12 Cedar Road');
  });

  it('rejects an empty address', () => {
    expect(() => Owner.register('user-1', '   ', DOB(), NOW)).toThrow(AppError);
  });

  it('emits nothing when the address is unchanged', () => {
    const owner = anOwner();
    owner.pullEvents();

    owner.changeAddress('12 Cedar Road,   Leeds', LATER);

    expect(owner.pullEvents()).toHaveLength(0);
  });

  it('records a real address change', () => {
    const owner = anOwner();
    owner.pullEvents();

    owner.changeAddress('9 Oak Lane, York', LATER);

    expect(owner.address).toBe('9 Oak Lane, York');
    expect(owner.pullEvents()).toMatchObject([{ name: 'owner.owner.address-changed' }]);
  });

  it('refuses to change the address of an inactive owner', () => {
    const owner = anOwner();
    owner.deactivate('user deleted', LATER);

    expect(() => owner.changeAddress('9 Oak Lane', LATER)).toThrow(AppError);
  });

  it('deactivates idempotently, so a redelivered event emits once', () => {
    const owner = anOwner();
    owner.pullEvents();

    owner.deactivate('user deleted', LATER);
    owner.deactivate('user deleted again', LATER);

    expect(owner.pullEvents()).toMatchObject([
      { name: 'owner.owner.deactivated', reason: 'user deleted' },
    ]);
  });

  it('reactivates only from inactive', () => {
    const owner = anOwner();
    owner.pullEvents();

    owner.reactivate(LATER);
    expect(owner.pullEvents()).toHaveLength(0);

    owner.deactivate('user deleted', LATER);
    owner.pullEvents();
    owner.reactivate(LATER);

    expect(owner.isActive).toBe(true);
    expect(owner.pullEvents()).toMatchObject([{ name: 'owner.owner.reactivated' }]);
  });
});
