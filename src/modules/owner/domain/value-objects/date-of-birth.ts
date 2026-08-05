import { AppError } from '../../../../shared/errors';

const MINIMUM_AGE = 18;
const MAXIMUM_AGE = 120;

/**
 * A value object rather than a bare `Date`, because "is this a legal owner?" is
 * a domain rule, not a validation concern — the DTO cannot express it and the
 * database will not enforce it.
 */
export class DateOfBirth {
  private constructor(readonly value: Date) {}

  static of(raw: Date | string, now: Date): DateOfBirth {
    const date = raw instanceof Date ? raw : new Date(raw);

    if (Number.isNaN(date.getTime())) {
      throw AppError.validation('dateOfBirth', 'is not a valid date');
    }

    if (date > now) {
      throw AppError.validation('dateOfBirth', 'cannot be in the future');
    }

    const age = ageIn(date, now);

    if (age < MINIMUM_AGE) {
      throw AppError.validation('dateOfBirth', `owner must be at least ${MINIMUM_AGE}`);
    }

    if (age > MAXIMUM_AGE) {
      throw AppError.validation('dateOfBirth', 'is implausible');
    }

    return new DateOfBirth(date);
  }

  /** Rehydration: a row that predates a rule change must still load. */
  static fromPersistence(value: Date): DateOfBirth {
    return new DateOfBirth(value);
  }

  ageAt(now: Date): number {
    return ageIn(this.value, now);
  }

  toISODate(): string {
    return this.value.toISOString().slice(0, 10);
  }
}

function ageIn(birth: Date, now: Date): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birth.getUTCMonth();

  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }

  return age;
}
