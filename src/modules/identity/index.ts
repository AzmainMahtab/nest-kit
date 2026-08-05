/**
 * The identity context's entire public surface. Another context may import from
 * here and nowhere else inside this folder (AGENTS.md §13), which is enforced by
 * `pnpm check:arch`.
 */
export { IdentityModule } from './identity.module';
export { UserRepository } from './domain/ports/user-repository.port';
export { User } from './domain/user';
export { UserStatus } from './domain/user-status';
export { Email } from './domain/value-objects/email';
export { UserDeleted, UserEmailChanged, UserRegistered, UserStatusChanged } from './domain/events';
