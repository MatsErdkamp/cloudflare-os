import type { ContractCaller } from "../authoring/contract-context.js";

/** Audit context minted for every public Contract session. */
export interface ContractCallContext<WorkpieceId = number, Caller = ContractCaller> {
  readonly callId: string;
  readonly contractId: WorkpieceId;
  readonly artifactHash: string;
  readonly sourceGatekeeperId: WorkpieceId;
  readonly caller: Caller;
  readonly startedAt: Date;
  /** Public method captured by the Consumer loopback, when the call began there. */
  readonly methodName?: string;
}

/** Attribution attached to provider observations and actions made through a Contract. */
export interface ContractActionAttribution<WorkpieceId = number> {
  readonly contractId: WorkpieceId;
  readonly artifactHash: string;
  readonly contractCallId: string;
  /** Public Contract method that caused the activity, when available. */
  readonly contractMethod?: string;
  readonly contractOperationId?: string;
}
