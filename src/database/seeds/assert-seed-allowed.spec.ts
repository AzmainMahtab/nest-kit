import { assertSeedAllowed } from './assert-seed-allowed';

describe('assertSeedAllowed', () => {
  it.each([['localhost'], ['127.0.0.1'], ['::1'], ['postgres'], ['db']])(
    'allows the local host %p',
    (host) => {
      expect(() => assertSeedAllowed({ host, allowRemote: false })).not.toThrow();
    },
  );

  it.each([['db.internal'], ['10.0.0.5'], ['prod-rds.eu-west-1.rds.amazonaws.com']])(
    'refuses %p without an explicit override',
    (host) => {
      expect(() => assertSeedAllowed({ host, allowRemote: false })).toThrow(/Refusing to seed/);
    },
  );

  it('names the host it refused, so the message says which .env is pointed where', () => {
    expect(() => assertSeedAllowed({ host: 'prod-rds.internal', allowRemote: false })).toThrow(
      /'prod-rds\.internal'/,
    );
  });

  it('allows a remote host when the override is set', () => {
    expect(() => assertSeedAllowed({ host: 'db.internal', allowRemote: true })).not.toThrow();
  });
});
