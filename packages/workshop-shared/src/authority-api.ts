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

/** Closed command for one separately reviewed standing Gadget installation. */
export interface InstallStandingBindingCommand extends AuthorityCommandEnvelope {
  /** Command discriminant. */
  readonly type: "installStandingBinding";
  /** Chat request retained only for projection after the canonical decision commits. */
  readonly requestId: string;
  /** Exact accepted Artifact Proposal. */
  readonly proposalId: string;
  /** Exact active Artifact Approval and epoch reviewed for installation. */
  readonly artifactApprovalId: string;
  /** Exact Artifact Approval epoch reviewed for installation. */
  readonly artifactApprovalEpoch: number;
  /** Gadget host identity whose canonical standing Consumer is selected. */
  readonly targetGadgetId: number;
  /** Gatekeeper host identity whose canonical Source is selected. */
  readonly sourceGatekeeperId: number;
  /** Exact published name and standing requirement key. */
  readonly bindingName: string;
  /** Binding generation the reviewed installation expects to replace. */
  readonly expectedBindingGeneration: number;
  /** Reviewed display metadata; it never participates in executable Artifact identity. */
  readonly title: string;
  /** Exact organization policy snapshot already cited by the Artifact Approval. */
  readonly evaluatorPolicyHash: string;
  /** Optional explicitly selected shared state root. */
  readonly sharedStateKey?: string;
}

/** Closed command requesting enforcement-first cancellation of one exact Agent Task generation. */
export interface CancelAgentTaskCommand extends AuthorityCommandEnvelope {
  /** Command discriminant. */
  readonly type: "cancelAgentTask";
  /** Canonical Agent Task identity. */
  readonly taskId: string;
  /** Exact Task generation shown to the operator. */
  readonly expectedTaskGeneration: number;
  /** Exact Task Environment generation shown to the operator. */
  readonly expectedEnvironmentGeneration: number;
  /** Exact Trust Ratchet version shown to the operator. */
  readonly expectedRatchetVersion: number;
}

/** Closed command union accepted by the Workspace Authority root. */
export type AuthorityCommand = DecideArtifactProposalCommand | InstallStandingBindingCommand |
  CancelAgentTaskCommand;

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

/** Durable result of one canonical standing Binding publication. */
export interface StandingBindingInstallationResult {
  /** Result discriminant. */
  readonly type: "standingBindingInstalled";
  /** Canonical records published by the installation. */
  readonly installationDecisionId: string;
  /** Fresh canonical Contract Instance prepared for the installation. */
  readonly contractInstanceId: string;
  /** Active canonical Binding published by the installation. */
  readonly bindingId: string;
  /** Immutable canonical placement Resolution published with the Binding. */
  readonly bindingResolutionId: string;
  /** Active Binding generation after the compare-and-swap. */
  readonly bindingGeneration: number;
}

/** Durable/local outcome of an explicit Agent Task cancellation request. */
export interface AgentTaskCancellationResult {
  /** Result discriminant. */
  readonly type: "agentTaskCancellationRequested";
  /** Canonical Agent Task identity. */
  readonly taskId: string;
  /** Monotonic cancellation generation. */
  readonly cancellationGeneration: number;
  /** Durable request state; transport completion does not imply endpoint invalidation. */
  readonly state: "requested" | "acknowledged";
}

/** Closed result union returned by Workspace Authority commands. */
export type AuthorityCommandResult = ArtifactDecisionResult | StandingBindingInstallationResult |
  AgentTaskCancellationResult;

/** One immutable Artifact Approval pinned by a Task Template Approval. */
export interface AgentTaskArtifactApprovalRef {
  /** Canonical Artifact Approval identity. */
  readonly id: string;
  /** Exact approval epoch. */
  readonly epoch: number;
}

/** Immutable Task Template governance shown to an authority operator. */
export interface AgentTaskTemplateReview {
  /** Canonical Task Template identity. */
  readonly id: string;
  /** Immutable version number. */
  readonly version: number;
  /** Canonical Task Template Approval identity. */
  readonly approvalId: string;
  /** Current approval lifecycle. */
  readonly approvalLifecycle: string;
  /** Previous immutable version superseded by this version, when any. */
  readonly supersedesVersion?: number;
  /** Content digest of the approved authority ceiling. */
  readonly ceilingDigest: string;
  /** Exact Artifact Approval epochs pinned by the template approval. */
  readonly artifactApprovals: readonly AgentTaskArtifactApprovalRef[];
}

/** One immutable requirement ceiling in a Task Template version. */
export interface TaskTemplateRequirementReview {
  /** Canonical Requirement identity. */
  readonly requirementId: string;
  /** Published Binding name. */
  readonly name: string;
  /** Whether dispatch fails when the requirement is unavailable. */
  readonly required: boolean;
  /** Maximum Effective Authority Envelope hash. */
  readonly authorityEnvelopeHash: string;
  /** Pinned Artifact Approval identity. */
  readonly artifactApprovalId: string;
  /** Pinned Artifact Approval epoch. */
  readonly artifactApprovalEpoch: number;
}

/** Immutable Task Template version and approval lifecycle for governance review. */
export interface TaskTemplateAuthorityView extends AgentTaskTemplateReview {
  /** Exact requirement ceilings in this immutable version. */
  readonly requirements: readonly TaskTemplateRequirementReview[];
  /** Maximum task duration admitted by this version. */
  readonly maximumTaskDurationMs: number;
  /** Human-readable normative consequence for new dispatches. */
  readonly newDispatchConsequence: string;
  /** Human-readable normative consequence for already-dispatched tasks. */
  readonly activeTaskConsequence: string;
}

/** Current bounded Task lease view. */
export interface AgentTaskLeaseView {
  /** Monotonic lease generation. */
  readonly generation: number;
  /** Current lease expiry in Unix milliseconds. */
  readonly expiresAt: number;
  /** Immutable absolute Task expiry in Unix milliseconds. */
  readonly absoluteExpiresAt: number;
}

/** One capability-free Binding reference in the current Task Environment. */
export interface AgentTaskBindingView {
  /** Published Binding name. */
  readonly name: string;
  /** Canonical Binding identity. */
  readonly bindingId: string;
  /** Canonical Contract Instance identity. */
  readonly contractInstanceId: string;
}

/** Current Task Environment and Trust Ratchet view. */
export interface AgentTaskEnvironmentView {
  /** Monotonic Task Environment generation. */
  readonly generation: number;
  /** Monotonic Trust Ratchet version. */
  readonly ratchetVersion: number;
  /** Current environment lifecycle. */
  readonly state: string;
  /** Authority digest admitted by the original dispatch. */
  readonly originalAuthorityDigest: string;
  /** Authority digest active in the current environment. */
  readonly currentAuthorityDigest: string;
  /** Capability-free references to current task Bindings. */
  readonly bindings: readonly AgentTaskBindingView[];
}

/** One bounded operational block safe for display. */
export interface AgentTaskOperationalBlock {
  /** Closed block category. */
  readonly type: "protectedResult" | "missingAcknowledgement" | "staleParallelWork";
  /** Stable capability-free record reference. */
  readonly reference: string;
}

/** Separately typed evidence references for one task. */
export interface AgentTaskEvidenceRefs {
  /** Workspace Authority Event references. */
  readonly authorityEvents: readonly string[];
  /** Provider-owned Source Activity references. */
  readonly sourceActivities: readonly string[];
  /** Workspace-owned Agent Activity references. */
  readonly agentActivities: readonly string[];
}

/** Canonical identity paired with one monotonic generation. */
export interface AgentTaskGenerationRef {
  /** Canonical identity. */
  readonly id: string;
  /** Monotonic generation. */
  readonly generation: number;
}

/** Durable cancellation state, distinct from transport completion. */
export interface AgentTaskCancellationView {
  /** Monotonic cancellation generation. */
  readonly generation: number;
  /** Durable/local cancellation state. */
  readonly state: "requested" | "acknowledged";
}

/** Bounded, capability-free operator view of one Agent Task and its immutable governance. */
export interface AgentTaskAuthorityView {
  /** Canonical Agent Task identity. */
  readonly taskId: string;
  /** Current Task generation. */
  readonly taskGeneration: number;
  /** Current lifecycle. */
  readonly lifecycle: string;
  /** Initiating Principal identity and generation. */
  readonly principal: AgentTaskGenerationRef;
  /** Agent Service Workload profile identity and generation. */
  readonly agentServiceProfile: AgentTaskGenerationRef;
  /** Canonical Agent Service Workload identity and generation. */
  readonly agentServiceWorkload: AgentTaskGenerationRef;
  /** Immutable approved Task Template identity and version. */
  readonly template: AgentTaskTemplateReview;
  /** Current lease and immutable absolute expiry. */
  readonly lease: AgentTaskLeaseView;
  /** Current Task Environment and Trust Ratchet generation. */
  readonly environment: AgentTaskEnvironmentView;
  /** Durable cancellation state, distinct from transport outcome. */
  readonly cancellation?: AgentTaskCancellationView;
  /** Bounded operational blocks safe for the authority UI. */
  readonly blocks: readonly AgentTaskOperationalBlock[];
  /** Separately typed evidence references; bodies and credentials are never included. */
  readonly evidence: AgentTaskEvidenceRefs;
}

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
  command:
    | Omit<DecideArtifactProposalCommand, "requestDigest">
    | Omit<InstallStandingBindingCommand, "requestDigest">
    | Omit<CancelAgentTaskCommand, "requestDigest">,
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
  /** Lists bounded current Agent Task authority views for review and operations. */
  listAgentTasks(): Promise<readonly AgentTaskAuthorityView[]>;
  /** Lists every approved immutable Task Template version and approval consequence. */
  listTaskTemplates(): Promise<readonly TaskTemplateAuthorityView[]>;
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
