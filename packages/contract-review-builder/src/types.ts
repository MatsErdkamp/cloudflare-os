import type {
  ContractArtifact,
  ContractBuildCandidate,
  ContractBuildInputs,
} from "@gadgets/contractors/artifact";

/** A bounded immutable blob named by its exact bytes. */
export interface ReviewBlobReference {
  readonly hash: string;
  readonly bytes: number;
  readonly mediaType: "application/json" | "text/plain" | "text/typescript" | "text/javascript";
}

/** Authenticated, non-authoritative provenance supplied with source inputs. */
export interface ReviewSubmittedProvenance {
  readonly submittedBy: Readonly<{readonly identity: string; readonly generation: number}>;
  readonly authorship: string;
  readonly origin:
    | Readonly<{readonly kind: "workspaceChat"; readonly reference: string}>
    | Readonly<{readonly kind: "gadget"; readonly reference: string}>
    | Readonly<{
        readonly kind: "repositoryClaim";
        readonly repository: string;
        readonly commit: string;
        readonly path: string;
      }>
    | Readonly<{readonly kind: "import"; readonly digest: string}>;
}

/** One exact resolved dependency in the trusted build closure. */
export interface ReviewDependencyLockEntry {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly packageContentHash: string;
  readonly dependencies?: readonly string[];
}

/** The complete sorted dependency closure used by one build. */
export interface ReviewDependencyLock {
  readonly entries: readonly ReviewDependencyLockEntry[];
}

/** One exact compiler, runtime, declaration, binary, or image identity. */
export interface ReviewToolchainComponent {
  readonly name: string;
  readonly identity: string;
}

/** The closed toolchain identity reported by a trusted build environment. */
export interface ReviewToolchainIdentity {
  readonly components: readonly ReviewToolchainComponent[];
}

/** The registered deterministic recipe executed by both trusted runners. */
export interface ReviewBuildRecipe {
  readonly name: string;
  readonly compatibilityDate: string;
  readonly compatibilityFlags: readonly string[];
  readonly target: string;
  readonly platform: string;
  readonly moduleFormat: string;
  readonly externals: readonly string[];
  readonly publicRoot: "ContractBinding";
  readonly authoringAbiHash: string;
  readonly runtimeHarnessHash: string;
  readonly runtimeModuleSetHash: string;
  readonly runtimeProfileHash: string;
}

/** Trusted isolation evidence for one fresh build environment. */
export interface ReviewRunnerIsolation {
  readonly role: "candidate" | "verifier";
  readonly producerIdentity: string;
  readonly environmentIdentity: string;
  readonly network: "disabled";
  readonly mutableState: "fresh";
  readonly networkAttempts: number;
}

/** Output returned by one trusted, network-disabled build runner. */
export interface ReviewBuildRunResult {
  readonly candidate: ContractBuildCandidate;
  readonly isolation: ReviewRunnerIsolation;
  readonly dependencyLock: ReviewDependencyLock;
  readonly toolchain: ReviewToolchainIdentity;
  readonly recipe: ReviewBuildRecipe;
  readonly directDependencyRequests: readonly Readonly<{
    readonly name: string;
    readonly version: string;
  }>[];
}

/** A fresh runner which owns no Workspace or provider capability. */
export interface ReviewBuildRunner extends Disposable {
  build(request: Readonly<{readonly inputs: ContractBuildInputs}>): Promise<ReviewBuildRunResult>;
}

/** Trusted host seam that creates two distinct isolated runners. */
export interface ReviewBuildRunnerFactory {
  create(request: Readonly<{
    readonly role: "candidate" | "verifier";
    readonly network: "disabled";
    readonly mutableState: "fresh";
  }>): ReviewBuildRunner;
}

/** A content-addressed comparison baseline. */
export type ReviewBaseline =
  | Readonly<{readonly kind: "none"}>
  | Readonly<{
      readonly kind: "bundle";
      readonly bundleHash: string;
      readonly artifactApprovalReference: string;
    }>;

/** Inputs accepted by the capability-free review evidence builder. */
export interface BuildContractReviewEvidenceInput {
  readonly inputs: ContractBuildInputs;
  readonly submittedProvenance: ReviewSubmittedProvenance;
  readonly policySnapshot: Readonly<{
    readonly allowedPackages?: readonly string[];
    readonly deniedPackages?: readonly string[];
    readonly maxBundleBytes?: number;
  }>;
  readonly baseline: ReviewBaseline;
  readonly baselineBundle?: ContractReviewBundle;
  readonly baselineBlobs?: ReadonlyMap<string, Uint8Array>;
  readonly comparisonGenerator: Readonly<{readonly name: string; readonly identity: string}>;
}

/** One trusted build attestation over exact content identities. */
export interface ReviewBuildAttestation extends ReviewRunnerIsolation {
  readonly inputSetHash: string;
  readonly artifactHash: string;
  readonly publicDeclarationHash: string;
  readonly sourceDeclarationHash: string;
  readonly dependencyLockHash: string;
  readonly directDependencyRequestsHash: string;
  readonly toolchainHash: string;
  readonly recipeHash: string;
  readonly buildTraceHash: string;
}

/** The sole current, unversioned Contract Review Bundle representation. */
export interface ContractReviewBundle {
  readonly artifact: Readonly<{
    readonly hash: string;
    readonly authority: ReviewBlobReference;
    readonly emittedModules: readonly Readonly<{readonly path: string; readonly blob: ReviewBlobReference}>[];
    readonly publicDeclaration: ReviewBlobReference;
  }>;
  readonly originalModules: readonly Readonly<{readonly path: string; readonly blob: ReviewBlobReference}>[];
  readonly source: Readonly<{
    readonly declaration: ReviewBlobReference;
    readonly rootType: string;
    readonly typeHash: string;
  }>;
  readonly build: Readonly<{
    readonly mainModule: string;
    readonly inputSetHash: string;
    readonly dependencyLock: ReviewBlobReference;
    readonly directDependencyRequests: ReviewBlobReference;
    readonly toolchain: ReviewBlobReference;
    readonly recipe: ReviewBlobReference;
    readonly trace: ReviewBlobReference;
    readonly policySnapshot: ReviewBlobReference;
  }>;
  readonly provenance: ReviewSubmittedProvenance;
  readonly attestations: readonly [ReviewBuildAttestation, ReviewBuildAttestation];
  readonly reproducibility: "reproduced";
  readonly baseline: ReviewBaseline;
}

/** One fixed comparison section retaining exact old and new evidence hashes. */
export interface ReviewComparisonSection {
  readonly name:
    | "originalModules"
    | "emittedExecutable"
    | "artifactAuthority"
    | "publicInterface"
    | "sourceDeclaration"
    | "dependencies"
    | "toolchainAndRecipe"
    | "originAndAuthorship"
    | "reproducibility";
  readonly change: "added" | "removed" | "modified" | "unchanged";
  readonly oldHash?: string;
  readonly newHash?: string;
  readonly items: readonly ReviewComparisonItem[];
}

/** One exact item-level review change with hashes retained when presentation is truncated. */
export interface ReviewComparisonItem {
  readonly key: string;
  readonly kind: "text" | "field" | "dependency" | "trace" | "toolchain" | "governance" | "attestation";
  readonly change: "added" | "removed" | "modified" | "unchanged";
  readonly oldHash?: string;
  readonly newHash?: string;
  readonly patch?: string;
  readonly patchTruncated?: true;
  readonly exportedSurface?: Readonly<{
    readonly oldHash?: string;
    readonly newHash?: string;
    readonly added: readonly string[];
    readonly removed: readonly string[];
  }>;
}

/** The sole current, unversioned Review Comparison representation. */
export interface ReviewComparison {
  readonly baseline: ReviewBaseline;
  readonly candidateBundleHash: string;
  readonly generator: Readonly<{readonly name: string; readonly identity: string}>;
  readonly sections: readonly ReviewComparisonSection[];
}

/** Fully verified evidence and exact immutable blobs ready for external publication. */
export interface BuiltContractReviewEvidence {
  readonly candidate: ContractBuildCandidate;
  readonly bundle: ContractReviewBundle;
  readonly bundleJson: string;
  readonly bundleHash: string;
  readonly comparison: ReviewComparison;
  readonly comparisonJson: string;
  readonly comparisonHash: string;
  readonly blobs: ReadonlyMap<string, Uint8Array>;
}

/** Exact Artifact accepted by evidence generation, retained for consumers of this package. */
export type ReviewedContractArtifact = ContractArtifact;
