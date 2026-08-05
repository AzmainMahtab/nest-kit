import { AppError } from '../../../../shared/errors';

const PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 254;

export class Email {
  private constructor(readonly value: string) {}

  static of(raw: string): Email {
    const normalised = raw.trim().toLowerCase();

    if (normalised.length === 0) {
      throw AppError.validation('email', 'must not be empty');
    }

    if (normalised.length > MAX_LENGTH) {
      throw AppError.validation('email', `must be at most ${MAX_LENGTH} characters`);
    }

    if (!PATTERN.test(normalised)) {
      throw AppError.validation('email', 'is not a valid email address');
    }

    return new Email(normalised);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
