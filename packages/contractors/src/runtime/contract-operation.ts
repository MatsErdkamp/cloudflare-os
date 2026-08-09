import type { ContractCaller } from "./contract-call.js";

/** Lifecycle of an explicitly authored Contract operation. */
export type ContractOperationState =
  | "pending"
  | "approved"
  | "rejected"
  | "applying"
  | "applied"
  | "failed";

/** Durable parent operation grouping any staged provider child actions. */
export interface ContractOperationRecord<WorkpieceId = number, Caller = ContractCaller> {
  readonly id: string;
  readonly contractId: WorkpieceId;
  readonly artifactHash: string;
  readonly caller: Caller;
  readonly title: string;
  readonly description: string;
  readonly state: ContractOperationState;
  readonly childActionIds: readonly number[];
  readonly approvalKey?: string;
  readonly createdAt: Date;
  readonly decidedAt?: Date;
}

/** Existing decision for one instance-scoped approval key. */
export interface ContractOperationDecision {
  readonly operationId: string;
  readonly state: "pending" | "approved" | "rejected";
}

/** Attribution shared by all host-created operations. */
export interface ContractOperationAttribution {
  readonly contractId: string;
  readonly artifactHash: string;
  readonly caller: ContractCaller;
}
