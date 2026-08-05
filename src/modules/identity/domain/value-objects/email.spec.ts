import { AppError } from '../../../../shared/errors';
import { Email } from './email';

describe('Email', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(Email.of('  Ada@Example.COM ').value).toBe('ada@example.com');
  });

  it.each([['no-at-sign'], [''], ['   '], ['a@b'], ['a b@example.com']])('rejects %p', (raw) => {
    expect(() => Email.of(raw)).toThrow(AppError);
  });

  it('rejects an address longer than 254 characters', () => {
    const long = `${'a'.repeat(250)}@example.com`;

    expect(() => Email.of(long)).toThrow(AppError);
  });

  it('reports the failing field so the filter can render it', () => {
    try {
      Email.of('nope');
      fail('expected a throw');
    } catch (error) {
      expect(AppError.is(error, 'VALIDATION_FAILED')).toBe(true);
      expect((error as AppError).details[0]?.field).toBe('email');
    }
  });

  it('compares by value', () => {
    expect(Email.of('ada@example.com').equals(Email.of('ADA@example.com'))).toBe(true);
    expect(Email.of('ada@example.com').equals(Email.of('grace@example.com'))).toBe(false);
  });
});
