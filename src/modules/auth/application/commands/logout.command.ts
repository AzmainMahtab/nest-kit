export class LogoutCommand {
  constructor(
    readonly sessionUuid: string,
    readonly accessJti: string,
    readonly accessExpiresAt: Date,
  ) {}
}
