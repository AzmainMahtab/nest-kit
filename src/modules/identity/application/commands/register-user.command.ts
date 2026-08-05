export class RegisterUserCommand {
  constructor(
    readonly email: string,
    readonly password: string,
  ) {}
}
