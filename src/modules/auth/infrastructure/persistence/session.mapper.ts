import { Session } from '../../domain/session';
import { SessionOrmEntity } from './session.orm-entity';

export const SessionMapper = {
  toDomain(row: SessionOrmEntity): Session {
    return Session.fromSnapshot({
      uuid: row.uuid,
      userUuid: row.userUuid,
      refreshJti: row.refreshJti,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    });
  },

  toOrm(session: Session, internalId?: string): SessionOrmEntity {
    const row = new SessionOrmEntity();

    if (internalId !== undefined) {
      row.id = internalId;
    }

    row.uuid = session.uuid;
    row.userUuid = session.userUuid;
    row.refreshJti = session.refreshJti;
    row.issuedAt = session.issuedAt;
    row.expiresAt = session.expiresAt;
    row.revokedAt = session.revokedAt;

    return row;
  },
};
