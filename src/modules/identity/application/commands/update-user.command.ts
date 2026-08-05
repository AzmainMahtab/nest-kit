import { UserStatus } from '../../domain/user-status';

export class UpdateUserCommand {
  constructor(
    readonly uuid: string,
    readonly email?: string,
    readonly status?: UserStatus,
  ) {}
}
