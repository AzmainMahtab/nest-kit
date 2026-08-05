import { AppError } from '../../../../shared/errors';

const PATTERN = /^[A-Z0-9]{2,10}$/;

/**
 * Normalises before validating, so "ab-12 cd" and "AB12CD" are the same plate.
 * Doing this in the value object rather than the DTO means every path into the
 * domain — HTTP, an event handler, a seeder — gets the same answer.
 */
export class LicensePlate {
  private constructor(readonly value: string) {}

  static of(raw: string): LicensePlate {
    const normalised = raw.toUpperCase().replace(/[\s-]/g, '');

    if (normalised.length === 0) {
      throw AppError.validation('licensePlate', 'must not be empty');
    }

    if (!PATTERN.test(normalised)) {
      throw AppError.validation(
        'licensePlate',
        'must be 2 to 10 letters or digits, ignoring spaces and dashes',
      );
    }

    return new LicensePlate(normalised);
  }

  static fromPersistence(value: string): LicensePlate {
    return new LicensePlate(value);
  }

  equals(other: LicensePlate): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
