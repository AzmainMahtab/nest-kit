import { backoffDelayMs } from './backoff';

describe('backoffDelayMs', () => {
  // random() at its ceiling shows the growth; at 0 it shows the floor.
  const atCeiling = (): number => 0.999999;
  const atFloor = (): number => 0;

  it('doubles the ceiling each attempt', () => {
    expect(backoffDelayMs(1, 100, 10_000, atCeiling)).toBe(99);
    expect(backoffDelayMs(2, 100, 10_000, atCeiling)).toBe(199);
    expect(backoffDelayMs(3, 100, 10_000, atCeiling)).toBe(399);
  });

  it('never exceeds the cap', () => {
    expect(backoffDelayMs(20, 100, 2000, atCeiling)).toBe(1999);
  });

  it('can return zero, because full jitter includes retrying at once', () => {
    expect(backoffDelayMs(5, 100, 2000, atFloor)).toBe(0);
  });

  it('treats a zero base as no delay at all, which is what tests want', () => {
    expect(backoffDelayMs(3, 0, 0, atCeiling)).toBe(0);
  });
});
