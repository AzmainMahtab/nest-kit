export class RegisterOwnerCommand {
  constructor(
    readonly userUuid: string,
    readonly address: string,
    readonly dateOfBirth: string,
  ) {}
}
