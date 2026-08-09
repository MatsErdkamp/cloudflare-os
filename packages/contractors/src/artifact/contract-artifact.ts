/** Exact authoring interface identity included in an Artifact hash. */
export interface ContractAuthoringAbiIdentity {
  readonly declarationHash: string;
}

/** Complete content-addressed Contract execution profile. */
export interface ContractRuntimeProfileIdentity {
  readonly profile: "cloudflare-workers-dynamic";
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly globalOutbound: "none";
  readonly runtimeHarnessHash: string;
  readonly runtimeModuleSetHash: string;
  readonly authoringAbi: ContractAuthoringAbiIdentity;
  readonly lifecycle: Readonly<{
    readonly maxCompositionDepth: 8;
    readonly observerDrainTimeoutMs: 1_000;
    readonly rawReadableStreams: "unsupported";
    readonly rawWritableStreams: "unsupported";
    readonly rawTransformStreams: "unsupported";
    readonly rawAsyncIterators: "unsupported";
    readonly rawAbortSignals: "unsupported";
    readonly upstreamCancellation: "mediated";
  }>;
}

/** One immutable dependency included in executable identity. */
export interface ContractArtifactDependency {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

/** Executable identity with creation and review metadata excluded. */
export interface ContractArtifact {
  readonly hash: string;
  readonly mainModule: "contract.js";
  readonly modules: Readonly<Record<string, string>>;
  readonly publicTypes: string;
  readonly publicRootType: "ContractBinding";
  readonly sourceTypeHash: string;
  readonly sourceRootType: string;
  readonly dependencies: readonly ContractArtifactDependency[];
  readonly runtimeProfile: ContractRuntimeProfileIdentity;
  readonly runtimeProfileHash: string;
}

/** Fields whose canonical representation defines executable authority. */
export type ContractArtifactHashInput = Omit<ContractArtifact, "hash">;

/** Exact normalized source and build-policy inputs returned with one candidate. */
export interface ContractBuildInputs {
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
export interface ContractBuildTrace {
  readonly entries: readonly ContractBuildTraceEntry[];
  readonly artifactHash: string;
}

/** One deterministic consumed or emitted compiler input in a build trace. */
export interface ContractBuildTraceEntry {
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
export interface ContractBuildCandidate {
  readonly artifact: ContractArtifact;
  readonly inputs: ContractBuildInputs;
  readonly trace: ContractBuildTrace;
  /** Non-authoritative creation metadata excluded from `artifact.hash`. */
  readonly creation: {
    readonly createdAt: string;
  };
}

const HASH = /^sha256:[0-9a-f]{64}$/;
const SOURCE_HASH = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === "string");
}

/** Parses the sole current, closed Contract Artifact representation. */
export function parseContractArtifact(value: unknown): ContractArtifact {
  if (!isRecord(value) || !hasExactKeys(value, [
    "dependencies", "hash", "mainModule", "modules", "publicRootType", "publicTypes",
    "runtimeProfile", "runtimeProfileHash", "sourceRootType", "sourceTypeHash",
  ]) || typeof value.hash !== "string" || !HASH.test(value.hash) ||
      value.mainModule !== "contract.js" || !isStringRecord(value.modules) ||
      typeof value.publicTypes !== "string" || value.publicRootType !== "ContractBinding" ||
      typeof value.sourceTypeHash !== "string" || !SOURCE_HASH.test(value.sourceTypeHash) ||
      typeof value.sourceRootType !== "string" || value.sourceRootType.length === 0 ||
      typeof value.runtimeProfileHash !== "string" || !HASH.test(value.runtimeProfileHash) ||
      !Array.isArray(value.dependencies) || !value.dependencies.every(dependency =>
        isRecord(dependency) && hasExactKeys(dependency, ["integrity", "name", "version"]) &&
        typeof dependency.name === "string" && dependency.name.length > 0 &&
        typeof dependency.version === "string" && dependency.version.length > 0 &&
        typeof dependency.integrity === "string" && dependency.integrity.length > 0)) {
    throw new TypeError("Invalid Contract artifact.");
  }
  const profile = value.runtimeProfile;
  if (!isRecord(profile) || !hasExactKeys(profile, [
    "authoringAbi", "compatibilityDate", "compatibilityFlags", "globalOutbound", "lifecycle",
    "profile", "runtimeHarnessHash", "runtimeModuleSetHash",
  ]) || profile.profile !== "cloudflare-workers-dynamic" ||
      typeof profile.compatibilityDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(profile.compatibilityDate) ||
      !Array.isArray(profile.compatibilityFlags) ||
      !profile.compatibilityFlags.every(flag => typeof flag === "string") ||
      profile.globalOutbound !== "none" ||
      typeof profile.runtimeHarnessHash !== "string" || !HASH.test(profile.runtimeHarnessHash) ||
      typeof profile.runtimeModuleSetHash !== "string" ||
      !HASH.test(profile.runtimeModuleSetHash) || !isRecord(profile.authoringAbi) ||
      !hasExactKeys(profile.authoringAbi, ["declarationHash"]) ||
      typeof profile.authoringAbi.declarationHash !== "string" ||
      !HASH.test(profile.authoringAbi.declarationHash) || !isRecord(profile.lifecycle) ||
      !hasExactKeys(profile.lifecycle, [
        "maxCompositionDepth", "observerDrainTimeoutMs", "rawAbortSignals", "rawAsyncIterators", "rawReadableStreams",
        "rawTransformStreams", "rawWritableStreams", "upstreamCancellation",
      ]) || profile.lifecycle.maxCompositionDepth !== 8 ||
      profile.lifecycle.observerDrainTimeoutMs !== 1_000 ||
      profile.lifecycle.rawReadableStreams !== "unsupported" ||
      profile.lifecycle.rawWritableStreams !== "unsupported" ||
      profile.lifecycle.rawTransformStreams !== "unsupported" ||
      profile.lifecycle.rawAsyncIterators !== "unsupported" ||
      profile.lifecycle.rawAbortSignals !== "unsupported" ||
      profile.lifecycle.upstreamCancellation !== "mediated") {
    throw new TypeError("Invalid Contract runtime profile.");
  }
  return value as unknown as ContractArtifact;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

/** Freezes the complete newly allocated candidate graph at the artifact boundary. */
export function freezeContractBuildCandidate(
  candidate: ContractBuildCandidate,
): ContractBuildCandidate {
  return deepFreeze(candidate);
}
