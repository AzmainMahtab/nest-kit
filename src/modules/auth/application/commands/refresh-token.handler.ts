import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { Clock, EventBus, Tokenizer, UnitOfWork } from '../../../../shared/application';
import { AppError } from '../../../../shared/errors';
import { RefreshTokenReplayed, SessionNotActive } from '../../domain/errors';
import { SessionRepository } from '../../domain/ports/session-repository.port';
import { TokenPair } from './login.command';
import { RefreshTokenCommand } from './refresh-token.command';

@CommandHandler(RefreshTokenCommand)
export class RefreshTokenHandler implements ICommandHandler<RefreshTokenCommand, TokenPair> {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokenizer: Tokenizer,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: RefreshTokenCommand): Promise<TokenPair> {
    const claims = await this.tokenizer.parseRefresh(command.refreshToken);
    const now = this.clock.now();

    const next = await this.tokenizer.issueRefresh(claims.sub, claims.sid);
    const access = await this.tokenizer.issueAccess(claims.sub, claims.sid);

    let replayed = false;

    await this.uow.withTransaction(async () => {
      const session = await this.sessions.findByUuid(claims.sid);

      if (!session) {
        throw SessionNotActive();
      }

      // Rotation and replay detection live in the aggregate; a replayed token
      // revokes the whole session there.
      try {
        session.rotate(claims.jti, next.jti, now, next.expiresAt);
      } catch (error) {
        if (!AppError.is(error, 'REFRESH_TOKEN_REPLAYED')) {
          throw error;
        }
        // Deliberately not rethrown here. Throwing inside the transaction would
        // roll back the very revocation the aggregate just performed, leaving
        // the attacker's newer token valid — the failure this detection exists
        // to prevent. Commit the revocation first, reject after.
        replayed = true;
      }

      await this.sessions.save(session);
      await this.events.publishAll(session.pullEvents());
    });

    if (replayed) {
      throw RefreshTokenReplayed();
    }

    return {
      accessToken: access.token,
      refreshToken: next.token,
      expiresAt: access.expiresAt,
    };
  }
}
