import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now: number;
  const clock = (): number => now;
  const breakerWith = (threshold = 3, resetMs = 1000): CircuitBreaker =>
    new CircuitBreaker(threshold, resetMs, clock);

  beforeEach(() => {
    now = 10_000;
  });

  it('starts closed and stays closed below the threshold', () => {
    const breaker = breakerWith();

    breaker.failed();
    breaker.failed();

    expect(breaker.state).toBe('closed');
    expect(breaker.allow()).toBe(true);
  });

  it('opens on the threshold failure and refuses calls', () => {
    const breaker = breakerWith();

    breaker.failed();
    breaker.failed();
    breaker.failed();

    expect(breaker.state).toBe('open');
    expect(breaker.allow()).toBe(false);
  });

  it('a success resets the count, so intermittent failures never open it', () => {
    const breaker = breakerWith();

    breaker.failed();
    breaker.failed();
    breaker.succeeded();
    breaker.failed();
    breaker.failed();

    expect(breaker.state).toBe('closed');
  });

  it('stays open until the reset window has fully elapsed', () => {
    const breaker = breakerWith(1, 1000);
    breaker.failed();

    now += 999;
    expect(breaker.allow()).toBe(false);

    now += 1;
    expect(breaker.allow()).toBe(true);
    expect(breaker.state).toBe('half-open');
  });

  it('lets exactly one probe through, not a herd', () => {
    const breaker = breakerWith(1, 1000);
    breaker.failed();
    now += 1000;

    expect(breaker.allow()).toBe(true);
    expect(breaker.allow()).toBe(false);
    expect(breaker.allow()).toBe(false);
  });

  it('closes when the probe succeeds', () => {
    const breaker = breakerWith(1, 1000);
    breaker.failed();
    now += 1000;
    breaker.allow();

    breaker.succeeded();

    expect(breaker.state).toBe('closed');
    expect(breaker.allow()).toBe(true);
  });

  it('re-opens for a fresh window when the probe fails', () => {
    const breaker = breakerWith(1, 1000);
    breaker.failed();
    now += 1000;
    breaker.allow();

    breaker.failed();

    expect(breaker.state).toBe('open');
    expect(breaker.allow()).toBe(false);

    now += 1000;
    expect(breaker.allow()).toBe(true);
  });
});
