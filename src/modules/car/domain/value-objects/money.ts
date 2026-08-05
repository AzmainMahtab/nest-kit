import { AppError } from '../../../../shared/errors';

const AMOUNT = /^-?\d{1,10}(\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;

/**
 * Money as a decimal **string**, never a JavaScript number (AGENTS.md §7).
 *
 * `0.1 + 0.2 !== 0.3` in binary floating point, and a price is not something to
 * be approximately right about. Postgres `NUMERIC` round-trips as a string
 * through the driver, so keeping it a string end to end means no conversion
 * ever happens — the temptation is `parseFloat`, and that is the bug.
 */
export class Money {
  private constructor(
    readonly amount: string,
    readonly currency: string,
  ) {}

  static of(amount: string, currency: string): Money {
    const normalisedCurrency = currency.trim().toUpperCase();

    if (!CURRENCY.test(normalisedCurrency)) {
      throw AppError.validation('currency', 'must be a three-letter ISO 4217 code');
    }

    const trimmed = amount.trim();

    if (!AMOUNT.test(trimmed)) {
      throw AppError.validation('amount', 'must be a decimal with at most two places');
    }

    if (trimmed.startsWith('-')) {
      throw AppError.validation('amount', 'must not be negative');
    }

    // Normalise "1200" and "1200.0" to the same stored form so equality and
    // the database representation agree.
    return new Money(toTwoPlaces(trimmed), normalisedCurrency);
  }

  static fromPersistence(amount: string, currency: string): Money {
    return new Money(amount, currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }
}

function toTwoPlaces(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}
