/** Host-neutral record for one installed Contract instance and Consumer binding. */
export interface ContractRecord<WorkpieceId = number> {
  readonly id: WorkpieceId;
  readonly artifactHash: string;
  /** Exact execution profile included in the installed Artifact hash. */
  readonly runtimeProfileHash: string;
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
