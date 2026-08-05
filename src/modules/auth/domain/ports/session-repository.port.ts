import { Session } from '../session';

export abstract class SessionRepository {
  abstract findByUuid(uuid: string): Promise<Session | null>;

  abstract save(session: Session): Promise<void>;

  /** Used when every session for a user must go, e.g. a password change. */
  abstract revokeAllForUser(userUuid: string, now: Date): Promise<void>;
}
