/** Host-neutral record for one installed Contract instance and Consumer binding. */
export interface ContractRecord<WorkpieceId = number> {
  readonly id: WorkpieceId;
  readonly artifactHash: string;
  /** Exact retained runtime harness included in the installed artifact hash. */
  readonly runtimeHarnessVersion: string;
  readonly sourceGatekeeperId: WorkpieceId;
  readonly title: string;
  readonly publicTypes: string;
  readonly createdAt: Date;
  readonly approvedBy: string;
  readonly sharedStateKey?: string;
  readonly pending?: {
    readonly chatId: number;
    readonly sequence?: number;
  };
}
