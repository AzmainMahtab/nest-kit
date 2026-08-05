import { Module } from '@nestjs/common';

import { DeleteUserHandler } from './application/commands/delete-user.handler';
import { RegisterUserHandler } from './application/commands/register-user.handler';
import { UpdateUserHandler } from './application/commands/update-user.handler';
import { GetUserHandler } from './application/queries/get-user.handler';
import { ListUsersHandler } from './application/queries/list-users.handler';
import { UserRepository } from './domain/ports/user-repository.port';
import { TypeOrmUserRepository } from './infrastructure/persistence/typeorm-user.repository';
import { UsersController } from './presentation/http/users.controller';

const handlers = [
  RegisterUserHandler,
  UpdateUserHandler,
  DeleteUserHandler,
  GetUserHandler,
  ListUsersHandler,
];

@Module({
  controllers: [UsersController],
  providers: [{ provide: UserRepository, useClass: TypeOrmUserRepository }, ...handlers],
  // Only the port is exported. Another context that needs user data gets the
  // contract, never the adapter, the handlers, or the ORM entity.
  exports: [UserRepository],
})
export class IdentityModule {}
