/** Immutable, content-addressed executable reviewed during Contract installation. */
export interface ContractArtifact {
  readonly hash: string;
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, string>>;
  readonly publicTypes: string;
  readonly publicRootType: "ContractBinding";
  readonly sourceTypeHash: string;
  readonly sourceRootType: string;
  readonly dependencies: ReadonlyArray<{
    readonly name: string;
    readonly version: string;
    readonly integrity?: string;
  }>;
  readonly compatibilityDate: string;
  /** Exact registered harness version that participates in this artifact's authority hash. */
  readonly runtimeHarnessVersion: string;
  readonly createdAt: string;
}

/** Artifact fields whose canonical representation defines executable authority. */
export type ContractArtifactHashInput = Omit<ContractArtifact, "hash" | "createdAt">;
