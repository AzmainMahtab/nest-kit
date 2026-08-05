export class RegisterCarCommand {
  constructor(
    readonly ownerUuid: string,
    readonly make: string,
    readonly model: string,
    readonly year: number,
    readonly colour: string,
    readonly licensePlate: string,
    readonly amount: string,
    readonly currency: string,
  ) {}
}

export class TransferCarCommand {
  constructor(
    readonly uuid: string,
    readonly toOwnerUuid: string,
  ) {}
}

export class RepriceCarCommand {
  constructor(
    readonly uuid: string,
    readonly amount: string,
    readonly currency: string,
  ) {}
}

export class RetireCarCommand {
  constructor(
    readonly uuid: string,
    readonly reason: string,
  ) {}
}
