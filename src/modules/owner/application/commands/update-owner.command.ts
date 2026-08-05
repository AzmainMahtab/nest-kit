export class UpdateOwnerAddressCommand {
  constructor(
    readonly uuid: string,
    readonly address: string,
  ) {}
}

export class DeactivateOwnerCommand {
  constructor(
    readonly uuid: string,
    readonly reason: string,
  ) {}
}
