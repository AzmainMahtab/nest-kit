import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { RegisterOwnerHandler } from './application/commands/register-owner.handler';
import {
  DeactivateOwnerHandler,
  UpdateOwnerAddressHandler,
} from './application/commands/update-owner.handler';
import { GetOwnerHandler, ListOwnersHandler } from './application/queries/owner.queries';
import { OwnerRepository } from './domain/ports/owner-repository.port';
import { DeactivateOwnerOnUserDeleted } from './infrastructure/event-handlers/deactivate-on-user-deleted.handler';
import { TypeOrmOwnerRepository } from './infrastructure/persistence/typeorm-owner.repository';
import { OwnersController } from './presentation/http/owners.controller';

@Module({
  // For identity's UserRepository port only.
  imports: [IdentityModule],
  controllers: [OwnersController],
  providers: [
    { provide: OwnerRepository, useClass: TypeOrmOwnerRepository },
    RegisterOwnerHandler,
    UpdateOwnerAddressHandler,
    DeactivateOwnerHandler,
    GetOwnerHandler,
    ListOwnersHandler,
    DeactivateOwnerOnUserDeleted,
  ],
  exports: [OwnerRepository],
})
export class OwnerModule {}
