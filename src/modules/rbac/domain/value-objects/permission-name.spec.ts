import { AppError } from '../../../../shared/errors';
import { PermissionName } from './permission-name';

describe('PermissionName', () => {
  it('splits resource from action', () => {
    const name = PermissionName.of('billing:refund');

    expect(name.resource).toBe('billing');
    expect(name.action).toBe('refund');
    expect(name.value).toBe('billing:refund');
  });

  it('trims surrounding whitespace', () => {
    expect(PermissionName.of('  billing:refund  ').value).toBe('billing:refund');
  });

  it.each([['Billing:refund'], ['billing:Refund'], ['BILLING:REFUND']])(
    'rejects %p rather than folding case',
    (raw) => {
      // Folding would let `Billing:refund` and `billing:refund` become one
      // permission silently; rejecting keeps the catalogue unambiguous.
      expect(() => PermissionName.of(raw)).toThrow(AppError);
    },
  );

  it.each([
    [''],
    ['billing'],
    ['billing:'],
    [':refund'],
    ['a:b:c'],
    ['1billing:refund'],
    ['billing:re fund'],
    ['billing:ré'],
  ])('rejects %p', (raw) => {
    expect(() => PermissionName.of(raw)).toThrow(AppError);
  });

  it('reports the failing field for the error filter', () => {
    try {
      PermissionName.of('nope');
      fail('expected a throw');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_PERMISSION_NAME');
      expect((error as AppError).details[0]?.field).toBe('name');
    }
  });

  it('compares by value', () => {
    expect(PermissionName.of('billing:refund').equals(PermissionName.of('billing:refund'))).toBe(
      true,
    );
    expect(PermissionName.of('billing:refund').equals(PermissionName.of('billing:void'))).toBe(
      false,
    );
  });
});
