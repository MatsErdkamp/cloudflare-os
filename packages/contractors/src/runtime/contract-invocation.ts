/** Closed generic authority generations observed by the Contract host at invocation. */
export interface ContractInvocationGenerations {
  readonly consumer: number;
  readonly binding: number;
  readonly contractInstance: number;
  readonly environment: number;
  readonly authority: number;
}

/** Immutable task-neutral invocation evidence produced by a Contract host. */
export interface ContractInvocationEvidence {
  readonly schemaVersion: 1;
  readonly invocationId: string;
  readonly consumerId: string;
  readonly bindingId: string;
  readonly contractInstanceId: string;
  readonly artifactHash: string;
  readonly runtimeProfileHash: string;
  readonly methodName: string;
  readonly startedAt: number;
  readonly authoritySnapshotDigest: string;
  readonly generations: ContractInvocationGenerations;
}

/** Exact validated input accepted only at the Contract host seam. */
export type ContractInvocationEvidenceInput = Omit<ContractInvocationEvidence, "schemaVersion">;
