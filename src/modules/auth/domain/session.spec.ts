import { AppError } from '../../../shared/errors';
import { Session } from './session';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-02T00:00:00.000Z');
const EXPIRY = new Date('2026-02-01T00:00:00.000Z');

const aSession = () => Session.start('s-1', 'u-1', 'jti-1', NOW, EXPIRY);

describe('Session', () => {
  it('starts active and records nothing', () => {
    const session = aSession();

    expect(session.isActive(NOW)).toBe(true);
    expect(session.pullEvents()).toHaveLength(0);
  });

  it('is inactive once expired', () => {
    expect(aSession().isActive(new Date('2026-03-01T00:00:00.000Z'))).toBe(false);
  });

  it('rotates to a new jti', () => {
    const session = aSession();

    session.rotate('jti-1', 'jti-2', LATER, EXPIRY);

    expect(session.refreshJti).toBe('jti-2');
    expect(session.isActive(LATER)).toBe(true);
  });

  it('revokes the whole session when a superseded token is replayed', () => {
    const session = aSession();
    session.rotate('jti-1', 'jti-2', LATER, EXPIRY);

    // The attacker presents the token the legitimate client already used.
    expect(() => session.rotate('jti-1', 'jti-3', LATER, EXPIRY)).toThrow(AppError);

    expect(session.isActive(LATER)).toBe(false);
    expect(session.revokedAt).toEqual(LATER);
    expect(session.pullEvents().map((e) => e.name)).toEqual(['auth.session.revoked']);
  });

  it('reports replay with its own code rather than a generic failure', () => {
    const session = aSession();
    session.rotate('jti-1', 'jti-2', LATER, EXPIRY);

    try {
      session.rotate('jti-1', 'jti-3', LATER, EXPIRY);
      fail('expected a throw');
    } catch (error) {
      expect(AppError.is(error, 'REFRESH_TOKEN_REPLAYED')).toBe(true);
    }
  });

  it('refuses to rotate a revoked session', () => {
    const session = aSession();
    session.revoke(LATER);

    expect(() => session.rotate('jti-1', 'jti-2', LATER, EXPIRY)).toThrow(AppError);
  });

  it('is idempotent on repeated revoke and emits once', () => {
    const session = aSession();

    session.revoke(LATER);
    session.revoke(new Date('2026-01-03T00:00:00.000Z'));

    expect(session.revokedAt).toEqual(LATER);
    expect(session.pullEvents()).toHaveLength(1);
  });
});
