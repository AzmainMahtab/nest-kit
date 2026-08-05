import { uuidv7 } from 'uuidv7';

import { DomainEvent } from '../../../shared/domain';
import { SessionRevoked } from './events';
import { RefreshTokenReplayed, SessionNotActive } from './errors';

export interface SessionSnapshot {
  uuid: string;
  userUuid: string;
  refreshJti: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export class Session {
  private readonly events: DomainEvent[] = [];

  private constructor(
    readonly uuid: string,
    readonly userUuid: string,
    private _refreshJti: string,
    readonly issuedAt: Date,
    private _expiresAt: Date,
    private _revokedAt: Date | null,
  ) {}

  static start(uuid: string, userUuid: string, refreshJti: string, now: Date, expiresAt: Date) {
    return new Session(uuid, userUuid, refreshJti, now, expiresAt, null);
  }

  static fromSnapshot(snapshot: SessionSnapshot): Session {
    return new Session(
      snapshot.uuid,
      snapshot.userUuid,
      snapshot.refreshJti,
      snapshot.issuedAt,
      snapshot.expiresAt,
      snapshot.revokedAt,
    );
  }

  static newUuid(): string {
    return uuidv7();
  }

  get refreshJti(): string {
    return this._refreshJti;
  }

  get expiresAt(): Date {
    return this._expiresAt;
  }

  get revokedAt(): Date | null {
    return this._revokedAt;
  }

  isActive(now: Date): boolean {
    return this._revokedAt === null && this._expiresAt > now;
  }

  /**
   * Rotation with replay detection.
   *
   * A refresh token is single-use. Presenting one whose `jti` is not the
   * currently stored one means it was captured and replayed — the legitimate
   * client has already rotated past it. The correct response is to revoke the
   * entire session, not just reject the request, because the attacker may hold
   * a newer token too.
   */
  rotate(presentedJti: string, nextJti: string, now: Date, expiresAt: Date): void {
    if (!this.isActive(now)) {
      throw SessionNotActive();
    }

    if (presentedJti !== this._refreshJti) {
      this.revoke(now);
      throw RefreshTokenReplayed();
    }

    this._refreshJti = nextJti;
    this._expiresAt = expiresAt;
  }

  revoke(now: Date): void {
    if (this._revokedAt !== null) {
      return;
    }

    this._revokedAt = now;
    this.record(new SessionRevoked(this.uuid, this.userUuid));
  }

  pullEvents(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}
