/** Exact authoring interface identity included in a v8 artifact hash. */
export interface ContractAuthoringAbiIdentity {
  readonly version: "8";
  readonly declarationHash: string;
}

/** Closed execution profile whose complete value participates in a v8 artifact hash. */
export interface ContractRuntimeProfileIdentity {
  readonly profile: "cloudflare-workers-dynamic";
  readonly version: "1";
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly globalOutbound: "none";
  readonly runtimeHarnessVersion: "8";
  readonly runtimeHarnessHash: string;
  readonly authoringAbi: ContractAuthoringAbiIdentity;
}

/** One immutable dependency included in executable identity. */
export interface ContractArtifactDependencyV2 {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

/** Additive v2 executable identity with creation and review metadata excluded. */
export interface ContractArtifactV2 {
  readonly formatVersion: 2;
  readonly hash: string;
  readonly mainModule: "contract.js";
  readonly modules: Readonly<Record<string, string>>;
  readonly publicTypes: string;
  readonly publicRootType: "ContractBinding";
  readonly sourceTypeHash: string;
  readonly sourceRootType: string;
  readonly dependencies: readonly ContractArtifactDependencyV2[];
  readonly runtimeProfile: ContractRuntimeProfileIdentity;
  readonly runtimeProfileHash: string;
}

/** V2 fields whose canonical representation defines executable authority. */
export type ContractArtifactV2HashInput = Omit<ContractArtifactV2, "hash">;

/** Exact normalized source and build-policy inputs returned with one candidate. */
export interface ContractBuildInputsV2 {
  readonly modules: Readonly<Record<string, string>>;
  readonly mainModule: string;
  readonly sourceTypes: string;
  readonly sourceRootType: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly organizationPolicy?: Readonly<{
    readonly allowedPackages?: readonly string[];
    readonly deniedPackages?: readonly string[];
    readonly maxBundleBytes?: number;
  }>;
}

/** Closed compiler trace used as review evidence without claiming approval. */
export interface ContractBuildTraceV2 {
  readonly schemaVersion: 1;
  readonly entries: readonly ContractBuildTraceEntryV2[];
  readonly artifactHash: string;
}

/** One deterministic consumed or emitted compiler input in a v8 build trace. */
export interface ContractBuildTraceEntryV2 {
  readonly kind:
    | "authoringAbi"
    | "sourceTypes"
    | "sourceModule"
    | "dependency"
    | "publicTypes"
    | "bundle"
    | "runtimeHarness";
  readonly path: string;
  readonly hash: string;
}

/** Compiler output awaiting independent review and approval. */
export interface ContractBuildCandidateV2 {
  readonly artifact: ContractArtifactV2;
  readonly inputs: ContractBuildInputsV2;
  readonly trace: ContractBuildTraceV2;
  /** Non-authoritative creation metadata excluded from `artifact.hash`. */
  readonly creation: {
    readonly createdAt: string;
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

/** Freezes the complete newly allocated candidate graph at the artifact boundary. */
export function freezeContractBuildCandidateV2(
  candidate: ContractBuildCandidateV2,
): ContractBuildCandidateV2 {
  return deepFreeze(candidate);
}
