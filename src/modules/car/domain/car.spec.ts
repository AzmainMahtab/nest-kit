import { AppError } from '../../../shared/errors';
import { Car, CarStatus } from './car';
import { LicensePlate } from './value-objects/license-plate';
import { Money } from './value-objects/money';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-02-01T00:00:00.000Z');

const aCar = (overrides: Partial<Parameters<typeof Car.register>[0]> = {}) =>
  Car.register({
    ownerUuid: 'owner-1',
    make: 'Toyota',
    model: 'Corolla',
    year: 2021,
    colour: 'silver',
    licensePlate: LicensePlate.of('AB12CD'),
    price: Money.of('18500', 'USD'),
    now: NOW,
    ...overrides,
  });

describe('Car', () => {
  it('registers active and records the event', () => {
    const car = aCar();

    expect(car.status).toBe(CarStatus.Active);
    expect(car.price.amount).toBe('18500.00');
    expect(car.pullEvents().map((e) => e.name)).toEqual(['car.car.registered']);
  });

  it('trims and collapses whitespace in text fields', () => {
    const car = aCar({ make: '  Land   Rover ', model: ' Defender  ' });

    expect(car.make).toBe('Land Rover');
    expect(car.model).toBe('Defender');
  });

  it.each([[1885], [2028], [1990.5]])('rejects the implausible year %p', (year) => {
    expect(() => aCar({ year })).toThrow(AppError);
  });

  it('accepts next year, since model years run ahead of the calendar', () => {
    expect(aCar({ year: 2027 }).year).toBe(2027);
  });

  it('transfers to a different owner and records both sides', () => {
    const car = aCar();
    car.pullEvents();

    car.transferTo('owner-2', LATER);

    expect(car.ownerUuid).toBe('owner-2');
    expect(car.pullEvents()).toMatchObject([
      { name: 'car.car.transferred', fromOwnerUuid: 'owner-1', toOwnerUuid: 'owner-2' },
    ]);
  });

  it('refuses a transfer to the current owner', () => {
    const car = aCar();

    expect(() => car.transferTo('owner-1', LATER)).toThrow(AppError);
  });

  it('emits nothing when repriced to the same value', () => {
    const car = aCar();
    car.pullEvents();

    car.reprice(Money.of('18500.00', 'USD'), LATER);

    expect(car.pullEvents()).toHaveLength(0);
    expect(car.updatedAt).toEqual(NOW);
  });

  it('records a reprice with the new amount', () => {
    const car = aCar();
    car.pullEvents();

    car.reprice(Money.of('17250.5', 'USD'), LATER);

    expect(car.price.amount).toBe('17250.50');
    expect(car.pullEvents()).toMatchObject([{ name: 'car.car.repriced', amount: '17250.50' }]);
  });

  it('refuses every change once retired', () => {
    const car = aCar();
    car.retire('owner deactivated', LATER);

    expect(car.isRetired).toBe(true);
    expect(() => car.transferTo('owner-2', LATER)).toThrow(AppError);
    expect(() => car.reprice(Money.of('1.00', 'USD'), LATER)).toThrow(AppError);
  });

  it('retires idempotently, so a redelivered event emits once', () => {
    const car = aCar();
    car.pullEvents();

    car.retire('first', LATER);
    car.retire('second', LATER);

    expect(car.pullEvents()).toMatchObject([{ name: 'car.car.retired', reason: 'first' }]);
  });
});
