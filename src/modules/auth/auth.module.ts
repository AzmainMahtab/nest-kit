import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { IdentityModule } from '../identity';
import { JwtAuthGuard } from '../../platform/http/guards/jwt-auth.guard';
import { LoginHandler } from './application/commands/login.handler';
import { LogoutHandler } from './application/commands/logout.handler';
import { RefreshTokenHandler } from './application/commands/refresh-token.handler';
import { SessionRepository } from './domain/ports/session-repository.port';
import { TypeOrmSessionRepository } from './infrastructure/persistence/typeorm-session.repository';
import { AuthController } from './presentation/http/auth.controller';

@Module({
  // For identity's UserRepository port only. Auth never touches its internals.
  imports: [IdentityModule],
  controllers: [AuthController],
  providers: [
    { provide: SessionRepository, useClass: TypeOrmSessionRepository },
    LoginHandler,
    RefreshTokenHandler,
    LogoutHandler,
    // Global: authentication is denied by default and every exception is
    // visible at the route that grants it with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [SessionRepository],
})
export class AuthModule {}
