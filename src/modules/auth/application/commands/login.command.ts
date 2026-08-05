export class LoginCommand {
  constructor(
    readonly email: string,
    readonly password: string,
  ) {}
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}
