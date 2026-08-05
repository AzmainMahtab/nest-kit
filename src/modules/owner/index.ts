export { OwnerModule } from './owner.module';
export { OwnerRepository } from './domain/ports/owner-repository.port';
export { Owner, OwnerStatus } from './domain/owner';
export { DateOfBirth } from './domain/value-objects/date-of-birth';
export {
  OwnerAddressChanged,
  OwnerDeactivated,
  OwnerReactivated,
  OwnerRegistered,
} from './domain/events';
