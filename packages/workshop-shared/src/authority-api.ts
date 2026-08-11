import {RpcStub, RpcTarget} from "capnweb";

/** Immutable evidence identity cited by one Artifact Proposal decision. */
export interface ArtifactDecisionEvidence {
  /** Canonical Artifact hash. */
  readonly artifactHash: string;
  /** Canonical Artifact Proposal ID. */
  readonly proposalId: string;
  /** Review Bundle manifest hash. */
  readonly reviewBundleHash: string;
  /** Review Comparison manifest hash. */
  readonly reviewComparisonHash: string;
  /** Evaluated organization-policy hash. */
  readonly policyHash: string;
  /** Trusted comparison-generator identity hash. */
  readonly generatorIdentityHash: string;
  /** Exact canonical baseline descriptor. */
  readonly baseline: Readonly<
    {readonly type: "none"} |
    {readonly type: "bundle"; readonly bundleHash: string; readonly artifactApprovalId: string}
  >;
}

/** Generation-bound snapshot of the caller's live Workspace Authority session. */
export interface AuthoritySessionSnapshot {
  /** Workspace-wide authority epoch captured by this session. */
  readonly authorityEpoch: number;
  /** Owner or manager-grant generation captured by this session. */
  readonly permissionGeneration: number;
}

/** Request to idempotently begin one durable authority operation. */
export interface BeginAuthorityOperation {
  /** Actor-scoped idempotency key for exact retries. */
  readonly idempotencyKey: string;
  /** Canonical digest of the root human intent. */
  readonly requestDigest: string;
}

/** Durable authority-issued operation identity. */
export interface AuthorityOperationView {
  /** Authority-issued operation ID. */
  readonly id: string;
  /** Canonical root request digest bound to the operation. */
  readonly requestDigest: string;
  /** Whether a command step has durably committed. */
  readonly state: "begun" | "completed";
  /** Last idempotent step known to have committed. */
  readonly lastCompletedStep?: string;
  /** Bounded durable command outcome used for disconnect recovery. */
  readonly result?: AuthorityCommandResult | AuthorityOwnerCommandResult;
}

/** Common replay and concurrency guard for an authority decision. */
export interface AuthorityCommandEnvelope {
  /** Stable operation identifier chosen for exact retries. */
  readonly operationId: string;
  /** Stable step key unique within the operation. */
  readonly stepKey: string;
  /** SHA-256 digest of the normalized command with this field omitted. */
  readonly requestDigest: string;
  /** Authority epoch the client reviewed. */
  readonly expectedAuthorityEpoch: number;
  /** Permission generation the client reviewed. */
  readonly expectedPermissionGeneration: number;
}

/** Closed command for approving or rejecting one exact Artifact Proposal revision. */
export interface DecideArtifactProposalCommand extends AuthorityCommandEnvelope {
  /** Command discriminant. */
  readonly type: "decideArtifactProposal";
  /** Chat projection to update after the durable decision commits. */
  readonly requestId: string;
  /** Proposal revision reviewed by the manager. */
  readonly expectedProposalRevision: number;
  /** Exact immutable proposal evidence. */
  readonly evidence: ArtifactDecisionEvidence;
  /** Manager decision; approval does not install the Artifact. */
  readonly decision: "approved" | "rejected";
}

/** Closed command union accepted by the Workspace Authority root. */
export type AuthorityCommand = DecideArtifactProposalCommand;

/** Durable result of an Artifact Proposal decision. */
export interface ArtifactDecisionResult {
  /** Result discriminant. */
  readonly type: "artifactProposalDecided";
  /** Durable Artifact Approval record ID. */
  readonly artifactApprovalId: string;
  /** Monotonic approval epoch for the Artifact. */
  readonly artifactApprovalEpoch: number;
  /** Decision that committed. */
  readonly decision: "approved" | "rejected";
}

/** Closed result union returned by Workspace Authority commands. */
export type AuthorityCommandResult = ArtifactDecisionResult;

function canonicalAuthorityJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorityJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (let index = 1; index < keys.length; index += 1) {
    const key = keys[index]!;
    let insertion = index;
    while (insertion > 0 && keys[insertion - 1]! > key) {
      keys[insertion] = keys[insertion - 1]!;
      insertion -= 1;
    }
    keys[insertion] = key;
  }
  return `{${keys.map(key =>
    `${JSON.stringify(key)}:${canonicalAuthorityJson(record[key])}`).join(",")}}`;
}

/** Computes the canonical SHA-256 assertion for a normalized authority command payload. */
export async function hashAuthorityCommand(
  command: Omit<DecideArtifactProposalCommand, "requestDigest">,
): Promise<string> {
  return hashAuthorityRequest(command);
}

/** Computes a canonical SHA-256 identity for an authority operation request. */
export async function hashAuthorityRequest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalAuthorityJson(value)),
  );
  return `sha256:${Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Revocable workspace-scoped authority-administration capability. */
export interface AuthorityApi extends RpcTarget {
  /** Reads the live epoch and permission generation bound to this session. */
  getSessionSnapshot(): Promise<AuthoritySessionSnapshot>;
  /** Begins or recovers one actor-bound durable operation. */
  beginOperation(request: BeginAuthorityOperation): Promise<AuthorityOperationView>;
  /** Recovers one operation by its authority-issued ID. */
  getOperation(operationId: string): Promise<AuthorityOperationView | null>;
  /** Executes one closed, generation-checked, idempotent authority command. */
  execute(command: AuthorityCommand): Promise<AuthorityCommandResult>;
  /** Opens owner-only grant administration, or returns null for a manager. */
  openOwnerControl(): Promise<RpcStub<AuthorityOwnerApi> | null>;
  /** Opens a guarded reader for the exact immutable evidence under review. */
  openReviewEvidence(request: OpenReviewEvidenceRequest): Promise<RpcStub<ReviewEvidenceReader>>;
}

/** Owner-only control over named `manageAuthority` grants. */
export interface AuthorityOwnerApi extends RpcTarget {
  /** Executes one owner-only, generation-checked, idempotent command. */
  execute(command: AuthorityOwnerCommand): Promise<AuthorityOwnerCommandResult>;
}

/** Owner command to grant or revoke one named authority manager. */
export interface SetAuthorityManagerGrantCommand extends AuthorityCommandEnvelope {
  /** Command discriminant. */
  readonly type: "setManagerGrant";
  /** Authenticated principal receiving or losing the grant. */
  readonly principalId: string;
  /** Whether the resulting grant is active. */
  readonly enabled: boolean;
}

/** Closed owner-only command union. */
export type AuthorityOwnerCommand = SetAuthorityManagerGrantCommand;

/** Result of changing one manager grant. */
export interface AuthorityManagerGrantResult {
  /** Result discriminant. */
  readonly type: "managerGrantChanged";
  /** New durable grant generation. */
  readonly generation: number;
  /** Resulting live grant state. */
  readonly state: "active" | "revoked";
}

/** Closed owner-only command result union. */
export type AuthorityOwnerCommandResult = AuthorityManagerGrantResult;

/** Exact Review Bundle and Review Comparison to expose through a guarded reader. */
export interface OpenReviewEvidenceRequest {
  /** Candidate Review Bundle hash. */
  readonly bundleHash: string;
  /** Review Comparison hash citing that Bundle. */
  readonly comparisonHash: string;
}

/** Content-addressed blob reference accepted by the guarded evidence reader. */
export interface ReviewEvidenceBlobReference {
  /** SHA-256 identity of the exact bytes. */
  readonly hash: string;
  /** Exact byte length. */
  readonly bytes: number;
  /** Declared media type. */
  readonly mediaType: "application/json" | "text/plain" | "text/typescript" | "text/javascript";
}

/** Generation-guarded reader for immutable review evidence; it conveys no storage capability. */
export interface ReviewEvidenceReader extends RpcTarget {
  /** Returns the canonical Review Bundle manifest JSON. */
  getBundleJson(): Promise<string>;
  /** Returns the canonical deterministically verified Review Comparison JSON. */
  getComparisonJson(): Promise<string>;
  /** Returns one hash- and length-verified blob cited by the Bundle. */
  getBlob(reference: ReviewEvidenceBlobReference): Promise<Uint8Array>;
}
