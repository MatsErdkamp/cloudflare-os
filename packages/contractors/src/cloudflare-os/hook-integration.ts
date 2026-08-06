/** Durable ownership metadata needed to disable a Contract-created hook during retraction. */
export interface ContractOwnedHook<WorkpieceId = number> {
  readonly contractId: WorkpieceId;
  readonly sourceGatekeeperId: WorkpieceId;
  readonly hookId: number;
}

