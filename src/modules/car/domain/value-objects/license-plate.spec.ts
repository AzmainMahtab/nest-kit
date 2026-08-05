import { AppError } from '../../../../shared/errors';
import { LicensePlate } from './license-plate';

describe('LicensePlate', () => {
  it('normalises case, spaces and dashes to one canonical form', () => {
    expect(LicensePlate.of('ab-12 cd').value).toBe('AB12CD');
    expect(LicensePlate.of('AB12CD').value).toBe('AB12CD');
    expect(LicensePlate.of('  ab 12 - cd ').value).toBe('AB12CD');
  });

  it('treats differently formatted plates as equal', () => {
    expect(LicensePlate.of('ab-12-cd').equals(LicensePlate.of('AB 12 CD'))).toBe(true);
  });

  it.each([[''], ['   '], ['A'], ['ABCDEFGHIJK'], ['AB_12'], ['ÄB12']])('rejects %p', (raw) => {
    expect(() => LicensePlate.of(raw)).toThrow(AppError);
  });

  it('reports the failing field for the error filter', () => {
    try {
      LicensePlate.of('!!');
      fail('expected a throw');
    } catch (error) {
      expect((error as AppError).details[0]?.field).toBe('licensePlate');
    }
  });
});
