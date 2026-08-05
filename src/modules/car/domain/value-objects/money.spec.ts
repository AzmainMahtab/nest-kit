import { AppError } from '../../../../shared/errors';
import { Money } from './money';

describe('Money', () => {
  it('normalises to two decimal places so storage and equality agree', () => {
    expect(Money.of('1200', 'usd').amount).toBe('1200.00');
    expect(Money.of('1200.5', 'USD').amount).toBe('1200.50');
    expect(Money.of('1200.50', 'USD').amount).toBe('1200.50');
  });

  it('upper-cases the currency', () => {
    expect(Money.of('10.00', 'eur').currency).toBe('EUR');
  });

  it('keeps the amount a string end to end', () => {
    // The whole point: a float cannot hold this exactly, and `parseFloat` here
    // is the bug the rule exists to prevent.
    const money = Money.of('0.10', 'USD');

    expect(typeof money.amount).toBe('string');
    expect(money.amount).toBe('0.10');
  });

  it.each([['abc'], [''], ['1.234'], ['1e5'], ['12,50']])('rejects the amount %p', (raw) => {
    expect(() => Money.of(raw, 'USD')).toThrow(AppError);
  });

  it('rejects a negative amount', () => {
    expect(() => Money.of('-1.00', 'USD')).toThrow(AppError);
  });

  it.each([['US'], ['USDD'], ['1SD'], ['']])('rejects the currency %p', (raw) => {
    expect(() => Money.of('10.00', raw)).toThrow(AppError);
  });

  it('compares by amount and currency', () => {
    expect(Money.of('10', 'USD').equals(Money.of('10.00', 'usd'))).toBe(true);
    expect(Money.of('10', 'USD').equals(Money.of('10.00', 'EUR'))).toBe(false);
    expect(Money.of('10', 'USD').equals(Money.of('10.01', 'USD'))).toBe(false);
  });

  it('trusts persisted values without re-normalising', () => {
    expect(Money.fromPersistence('9.99', 'GBP').toString()).toBe('9.99 GBP');
  });
});
