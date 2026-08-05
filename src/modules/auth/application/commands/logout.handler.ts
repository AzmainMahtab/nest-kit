import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';

import { Clock, EventBus, TokenBlacklist, UnitOfWork } from '../../../../shared/application';
import { UserLoggedOut } from '../../domain/events';
import { SessionRepository } from '../../domain/ports/session-repository.port';
import { LogoutCommand } from './logout.command';

@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand, void> {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly blacklist: TokenBlacklist,
    private readonly events: EventBus,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(command: LogoutCommand): Promise<void> {
    const now = this.clock.now();

    await this.uow.withTransaction(async () => {
      const session = await this.sessions.findByUuid(command.sessionUuid);

      // Already gone is success. Logout must be idempotent — a client retrying
      // after a dropped response should not see an error.
      if (!session) {
        return;
      }

      session.revoke(now);
      await this.sessions.save(session);
      await this.events.publish(new UserLoggedOut(session.userUuid, session.uuid));
    });

    // Revoking the session stops refresh; blacklisting the access token is what
    // stops the current one before it expires on its own.
    await this.blacklist.revoke(command.accessJti, command.accessExpiresAt);
  }
}
