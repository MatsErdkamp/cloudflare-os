import type {WorkpieceId} from "@gadgets/workshop-shared/api";
import type {
  ContractInvalidationAcknowledgement,
  ContractReachabilitySnapshot,
} from "@gadgets/contractors/runtime";
import type {
  ProviderAuthorityIdentity,
  ProviderNativeAuthorityScope,
} from "@gadgets/workshop-shared/gatekeeper-authority";
import type {RatchetAuthorityEnvelope} from "./trust-ratchet";

declare const authorityIdKind: unique symbol;

/** One Workspace-issued opaque identifier. */
export type AuthorityId<Kind extends string> = string & {readonly [authorityIdKind]: Kind};

/** Opaque identities used by canonical Workspace Authority records. */
export type ArtifactApprovalId = AuthorityId<"artifactApproval">;
export type ArtifactProposalId = AuthorityId<"artifactProposal">;
export type InstallationDecisionId = AuthorityId<"installationDecision">;
export type TaskDispatchDecisionId = AuthorityId<"taskDispatchDecision">;
export type BindingResolutionId = AuthorityId<"bindingResolution">;
export type ContractInstanceId = AuthorityId<"contractInstance">;
export type BindingId = AuthorityId<"binding">;
export type RuntimeApprovalRequestId = AuthorityId<"runtimeApprovalRequest">;
export type RuntimeApprovalDecisionId = AuthorityId<"runtimeApprovalDecision">;
export type AuthorityDebtId = AuthorityId<"authorityDebt">;
export type ConsumerId = AuthorityId<"consumer">;
export type SourceId = AuthorityId<"source">;
export type RequirementId = AuthorityId<"requirement">;
export type TaskTemplateId = AuthorityId<"taskTemplate">;
export type TaskTemplateApprovalId = AuthorityId<"taskTemplateApproval">;
export type AgentTaskId = AuthorityId<"agentTask">;
export type AuthorityTombstoneId = AuthorityId<"authorityTombstone">;
export type BindingPublicationPlanId = AuthorityId<"bindingPublicationPlan">;
export type InvalidationIntentId = AuthorityId<"invalidationIntent">;

/** A standing or task-scoped Consumer reference pinned to one generation. */
export type ConsumerReference =
  | {readonly type: "standing"; readonly consumerId: ConsumerId; readonly generation: number}
  | {
      readonly type: "agentTask";
      readonly consumerId: ConsumerId;
      readonly taskId: string;
      readonly taskGeneration: number;
    };

/** The exact immutable requirement selected by one Binding Resolution. */
export type BindingRequirementReference =
  | {
      readonly type: "environment";
      readonly bindingSetId: string;
      readonly bindingSetVersion: number;
      readonly requirementId: RequirementId;
      readonly requirementVersion: number;
    }
  | {
      readonly type: "taskTemplate";
      readonly taskTemplateId: TaskTemplateId;
      readonly taskTemplateVersion: number;
      readonly requirementId: RequirementId;
    };

/** The exact durable decision that selected one placement. */
export type PlacementDecisionReference =
  | {readonly type: "installation"; readonly decisionId: InstallationDecisionId}
  | {readonly type: "taskDispatch"; readonly decisionId: TaskDispatchDecisionId};

/** The provider-side authority selected for one placement, pinned to every relevant generation. */
export type UpstreamAuthorityReference = {
  readonly sourceId: SourceId;
  readonly sourceGeneration: number;
  readonly origin:
    | {readonly type: "workspaceAccount"; readonly id: string; readonly generation: number}
    | {readonly type: "personalSourceGrant"; readonly id: string; readonly generation: number};
};

/** Upstream Authority permitted for new placements after canonical cutover. */
export type LiveUpstreamAuthorityReference = Omit<UpstreamAuthorityReference, "origin"> & {
  readonly origin:
    | {readonly type: "workspaceAccount"; readonly id: string; readonly generation: number}
    | {readonly type: "personalSourceGrant"; readonly id: string; readonly generation: number};
};

/** Exact verification evidence used by a Resolution. */
export type BindingVerificationReference =
  | {readonly type: "notRequired"}
  | {readonly type: "receipt"; readonly receiptId: string; readonly verifierGeneration: number};

/** Whether an instance owns isolated state or joins one explicitly selected shared state root. */
export type SharedStateChoice =
  | {readonly type: "isolated"}
  | {readonly type: "shared"; readonly key: string};

/** One normalized authority scope used for provider-native/effective comparison. */
export type AuthorityScope = Readonly<{
  provider: string;
  resources: readonly string[];
  operations: readonly string[];
  recipients: readonly string[];
  egress: readonly string[];
}>;

/** Immutable evidence references proposed for a later Artifact decision. */
export type ArtifactProposalRecord = Readonly<{
  id: ArtifactProposalId;
  artifactHash: string;
  runtimeProfileHash: string;
  reviewBundleHash: string;
  reviewComparisonHash: string;
  policyHash: string;
  baseline:
    | {readonly type: "none"}
    | {
        readonly type: "bundle";
        readonly bundleHash: string;
        readonly artifactApprovalId: ArtifactApprovalId;
      };
  generatorIdentityHash: string;
  proposedBy: string;
  proposedAt: number;
  state: "pending" | "accepted" | "rejected";
  revision: number;
}>;

type ArtifactApprovalRecordBase = Readonly<{
  id: ArtifactApprovalId;
  artifactHash: string;
  approvalEpoch: number;
  decision: "approved" | "rejected";
  decidedBy: string;
  permissionGeneration?: number;
  decisionSequence: number;
  lifecycle: "active" | "deprecated" | "revoked";
  revision: number;
}>;

/** An Artifact decision, distinct from installation or possession. */
export type ArtifactApprovalRecord = ArtifactApprovalRecordBase & Readonly<{
  evidence: "complete";
  proposalId: ArtifactProposalId;
  reviewBundleHash: string;
  reviewComparisonHash: string;
  policyHash: string;
  baseline: ArtifactProposalRecord["baseline"];
  generatorIdentityHash: string;
}>;

/** A standing placement decision; it never represents Artifact review or task dispatch. */
export type InstallationDecisionRecord = Readonly<{
  id: InstallationDecisionId;
  operationId: string;
  proposalDigest: string;
  decision: "approved" | "denied" | "expired";
  decidedBy: string;
  permissionGeneration?: number;
  decisionSequence: number;
  consumer?: ConsumerReference;
  requirement?: BindingRequirementReference;
  intendedBindingName?: string;
  expectedBindingGeneration?: number;
  artifactApprovalId?: ArtifactApprovalId;
  upstreamAuthority?: UpstreamAuthorityReference;
  authorityMode?: "personal" | "shared" | "verified";
  sharedState?: SharedStateChoice;
  evaluatorPolicyHash?: string;
  runtimeWorkpieceId?: WorkpieceId;
  reason?: string;
}>;

/** One immutable per-task decision; it is never an Installation or runtime Approval decision. */
export type TaskDispatchDecisionRecord = Readonly<{
  id: TaskDispatchDecisionId;
  operationId: string;
  taskId: string;
  taskGeneration: number;
  taskTemplateId: TaskTemplateId;
  taskTemplateVersion: number;
  taskTemplateApprovalId: string;
  consumer: Extract<ConsumerReference, {type: "agentTask"}>;
  requirements: readonly BindingRequirementReference[];
  effectiveAuthorityEnvelopeHash: string;
  initiatingPrincipal: {readonly id: string; readonly generation: number};
  agentServiceWorkloadId: string;
  agentServiceWorkloadGeneration: number;
  agentServiceProfileId: string;
  agentServiceProfileGeneration: number;
  workloadRegistrationId: string;
  workloadRegistrationGeneration: number;
  eligibilityEvidence: readonly Readonly<{
    requirementId: RequirementId;
    upstreamAuthority: UpstreamAuthorityReference;
    providerCapabilityGeneration: number;
    verification: BindingVerificationReference;
    evaluatorPolicyHash: string;
    authorityDebtId: AuthorityDebtId;
    authorityDebtRevision: number;
    egress: readonly [];
  }>[];
  parentTaskId?: string;
  absoluteExpiry: number;
  decision: "approved" | "denied";
  decidedBy: string;
  decisionSequence: number;
}>;

/** One role/profile attached one-to-one to a registered standing Workload. */
export type AgentServiceProfileRecord = Readonly<{
  id: string;
  workloadId: string;
  workloadGeneration: number;
  workloadConsumer: Extract<ConsumerReference, {type: "standing"}>;
  workloadRegistrationId: string;
  workloadRegistrationGeneration: number;
  role: string;
  generation: number;
  lifecycle: "active" | "suspended" | "retired";
}>;

/** Canonical current Workspace human identity eligible to initiate a Task. */
export type WorkspacePrincipalRecord = Readonly<{
  id: string;
  kind: "owner" | "member";
  generation: number;
  lifecycle: "active" | "revoked";
}>;

/** One exact standing Binding admitted as upstream for a Task requirement. */
export type TaskStandingBindingReference = Readonly<{
  name: string;
  bindingId: BindingId;
  bindingGeneration: number;
  contractInstanceId: ContractInstanceId;
  contractInstanceGeneration: number;
}>;

/** One immutable requirement in a complete Task Template version. */
export type TaskTemplateRequirementRecord = Readonly<{
  requirementId: RequirementId;
  name: string;
  required: boolean;
  artifactApprovalId: ArtifactApprovalId;
  artifactApprovalEpoch: number;
  standingBinding: TaskStandingBindingReference;
  maximumEffectiveAuthorityEnvelopeHash: string;
  maximumAuthority: RatchetAuthorityEnvelope;
  evaluatorPolicyHash: string;
  sharedState: SharedStateChoice;
}>;

/** One complete immutable version in a Task Template lineage. */
export type TaskTemplateVersionRecord = Readonly<{
  id: string;
  taskTemplateId: TaskTemplateId;
  version: number;
  requirements: readonly TaskTemplateRequirementRecord[];
  maximumTaskDurationMs: number;
  principalEligibility:
    | {readonly type: "workspaceMembers"}
    | {readonly type: "named"; readonly principalIds: readonly string[]};
  runtimeEnforcementProfile: "r2-task-v1";
  ceilingDigest: string;
  supersedesVersion?: number;
}>;

/** Immutable human approval over one exact Task Template version and ceiling. */
export type TaskTemplateApprovalRecord = Readonly<{
  id: TaskTemplateApprovalId;
  taskTemplateId: TaskTemplateId;
  taskTemplateVersion: number;
  approvalEpoch: number;
  ceilingDigest: string;
  artifactApprovals: readonly Readonly<{
    id: ArtifactApprovalId;
    epoch: number;
  }>[];
  decidedBy: string;
  permissionGeneration: number;
  decidedAt: number;
  lifecycle: "active" | "deprecated" | "revoked";
}>;

/** Immutable identity/generation correlation carried by one Agent Task. */
export type TaskAuthorityCorrelation = Readonly<{
  taskId: AgentTaskId;
  taskGeneration: number;
  principal: Readonly<{id: string; generation: number}>;
  applicationScope?: Readonly<{
    kind: "workspaceApplication";
    scopeId: string;
    scopeGeneration: number;
  }>;
  actorChain: readonly Readonly<{
    type: "workspacePrincipal" | "agentServiceWorkload";
    id: string;
    generation: number;
  }>[];
}>;

/** One bounded execution and its current lease/environment generations. */
export type AgentTaskRecord = Readonly<{
  id: AgentTaskId;
  consumerId: ConsumerId;
  generation: number;
  dispatchDecisionId: TaskDispatchDecisionId;
  templateApprovalId: TaskTemplateApprovalId;
  agentServiceProfileId: string;
  agentServiceProfileGeneration: number;
  correlation: TaskAuthorityCorrelation;
  intentDigest: string;
  createdAt: number;
  absoluteExpiresAt: number;
  leaseGeneration: number;
  leaseExpiresAt: number;
  environmentGeneration: number;
  ratchetVersion: number;
  lifecycle: "dispatching" | "running" | "awaitingApproval" | "awaitingChild" |
    "suspendedLeaseExpired" | "completed" | "failed" | "cancelled" | "expired";
}>;

/** Durable enforcement-first cancellation request for one exact Agent Task generation. */
export type AgentTaskCancellationRecord = Readonly<{
  taskId: AgentTaskId;
  generation: number;
  expectedTaskGeneration: number;
  expectedEnvironmentGeneration: number;
  expectedRatchetVersion: number;
  requestedBy: string;
  requestedAt: number;
  state: "requested" | "acknowledged";
}>;

/** Bounded task-operation references projected into the authority review surface. */
export type AgentTaskOperationalRecord = Readonly<{
  taskId: AgentTaskId;
  taskGeneration: number;
  environmentGeneration: number;
  ratchetVersion: number;
  protectedResultRefs: readonly string[];
  missingAcknowledgementRefs: readonly string[];
  staleParallelWorkRefs: readonly string[];
  sourceActivityRefs: readonly string[];
  agentActivityRefs: readonly string[];
  revision: number;
}>;

/** Durable enforcement-first terminal intent and exact endpoint invalidation receipt. */
export type AgentTaskTerminalIntentRecord = Readonly<{
  id: string;
  operationId: string;
  taskId: AgentTaskId;
  expectedTaskGeneration: number;
  expectedEnvironmentGeneration: number;
  expectedRatchetVersion: number;
  outcome: "completed" | "cancelled" | "failed" | "expired";
  state: "planned" | "invalidated" | "committed";
  endpointAcknowledgements: readonly ContractInvalidationAcknowledgement[];
}>;

/** Exact idempotency receipt for one committed canonical Trust Ratchet replacement. */
export type AgentTaskRatchetReceiptRecord = Readonly<{
  operationId: string;
  requestDigest: string;
  taskId: AgentTaskId;
  environmentGeneration: number;
  ratchetVersion: number;
  networkGeneration: number;
}>;

/** One immutable manifest of the exact task placements for one environment generation. */
export type TaskEnvironmentRecord = Readonly<{
  id: string;
  taskId: AgentTaskId;
  taskGeneration: number;
  generation: number;
  ratchetVersion: number;
  networkGeneration: number;
  cancellationId: string;
  cancellationGeneration: number;
  leaseGeneration: number;
  leaseExpiresAt: number;
  absoluteExpiresAt: number;
  correlation: TaskAuthorityCorrelation;
  effectiveAuthorityDigest: string;
  bindings: readonly Readonly<{
    name: string;
    required: boolean;
    requirementId: RequirementId;
    resolutionId: BindingResolutionId;
    contractInstanceId: ContractInstanceId;
    bindingId: BindingId;
    upstreamBinding: TaskStandingBindingReference;
    authority: RatchetAuthorityEnvelope;
  }>[];
  omittedOptionalRequirements: readonly Readonly<{
    requirementId: RequirementId;
    reason: "unavailable";
  }>[];
  state: "materializing" | "ready" | "invalidated";
}>;

/** The one canonical immutable placement result used by standing and Agent Task authority. */
export type BindingResolutionRecord = Readonly<{
  id: BindingResolutionId;
  consumer: ConsumerReference;
  requirement: BindingRequirementReference;
  upstreamAuthority: UpstreamAuthorityReference;
  verification: BindingVerificationReference;
  artifactApprovalId: ArtifactApprovalId;
  artifactApprovalEpoch: number;
  placementDecision: PlacementDecisionReference;
  contractInstanceId: ContractInstanceId;
  bindingId: BindingId;
  sharedState: SharedStateChoice;
  expectedBindingGeneration: number;
  evaluatorPolicyHash: string;
  /** Exact standing Binding attenuated by a Task placement, when applicable. */
  upstreamBinding?: TaskStandingBindingReference;
  createdSequence: number;
}>;

/** One prepared executable instance. Its authority tuple never changes after creation. */
export type ContractInstanceRecord = Readonly<{
  id: ContractInstanceId;
  /** Host transport locator; it is never evidence of authority or Binding possession. */
  runtimeWorkpieceId?: WorkpieceId;
  /** Host locator for the selected Gatekeeper Source; never exposed to the Consumer. */
  sourceGatekeeperId?: WorkpieceId;
  /** Exact provider backing returned for this instance; it carries no credential or raw Source. */
  providerBacking?: Readonly<{
    provider: ProviderAuthorityIdentity;
    backingReference: string;
    capabilityGeneration: number;
    providerNativeScope: ProviderNativeAuthorityScope;
    providerNativeRevocationGranularity: string;
    localEnforcementRevocationGranularity: string;
  }>;
  artifactApprovalId: ArtifactApprovalId;
  artifactHash: string;
  runtimeProfileHash: string;
  upstreamAuthority: UpstreamAuthorityReference;
  placementDecision: PlacementDecisionReference;
  intendedConsumer?: ConsumerReference;
  intendedRequirement?: BindingRequirementReference;
  sharedState: SharedStateChoice;
  lifecycle: "prepared" | "ready" | "suspended" | "retracted";
  generation: number;
  revision: number;
  createdSequence: number;
  predecessorId?: ContractInstanceId;
  /** Ratchet transition identity distinguishing task-local replacement generations. */
  ratchetLineageKey?: string;
  rollbackToId?: ContractInstanceId;
}>;

/** The generation-tagged possession of one Contract Instance by one Consumer. */
export type BindingRecord = Readonly<{
  id: BindingId;
  consumer: ConsumerReference;
  name: string;
  requirement: BindingRequirementReference;
  contractInstanceId: ContractInstanceId;
  resolutionId: BindingResolutionId;
  status: "preparing" | "active" | "suspended" | "retracted";
  generation: number;
  revision: number;
  installedSequence: number;
  /** Exact acknowledged Contract Facet snapshot enforcing this Binding generation. */
  endpointSnapshot?: ContractReachabilitySnapshot;
  predecessorId?: BindingId;
}>;

/** Durable pre-publication state for one exact generation-CAS Binding decision. */
export type BindingPublicationPlanRecord = Readonly<{
  id: BindingPublicationPlanId;
  operationId: string;
  contractInstanceId: ContractInstanceId;
  consumer: ConsumerReference;
  requirement: BindingRequirementReference;
  name: string;
  verification: BindingVerificationReference;
  evaluatorPolicyHash: string;
  expectedBindingGeneration: number;
  targetBindingGeneration: number;
  bindingId: BindingId;
  resolutionId: BindingResolutionId;
  predecessorId?: BindingId;
  endpointSnapshot?: ContractReachabilitySnapshot;
  state: "planned" | "endpointAcknowledged" | "invalidationPending" |
    "readyToCommit" | "committed" | "obsolete";
}>;

/** Durable enforcement-first intent for one exact old Binding generation. */
export type InvalidationIntentRecord = Readonly<{
  id: InvalidationIntentId;
  operationId: string;
  planId?: BindingPublicationPlanId;
  bindingId: BindingId;
  bindingGeneration: number;
  endpointSnapshot: ContractReachabilitySnapshot;
  replacementBindingId?: BindingId;
  replacementGeneration?: number;
  terminalTarget?: "suspended" | "retracted";
  reason?: string;
  state: "pending" | "acknowledged" | "committed";
}>;

/** A runtime request to release authority already present in an installed Contract. */
export type RuntimeApprovalRequestRecord = Readonly<{
  id: RuntimeApprovalRequestId;
  bindingId: BindingId;
  bindingGeneration: number;
  invocationId: string;
  operation: string;
  requestedAt: number;
  expiresAt: number;
  state: "pending" | "decided" | "expired" | "cancelled";
  revision: number;
}>;

/** A runtime gate decision that can release but never create, broaden, extend, or restore authority. */
export type RuntimeApprovalDecisionRecord = Readonly<{
  id: RuntimeApprovalDecisionId;
  requestId: RuntimeApprovalRequestId;
  decision: "released" | "denied";
  decidedBy: string;
  permissionGeneration?: number;
  decidedAt: number;
  reason?: string;
}>;

/** Visible residual risk where effective authority is narrower than provider-native authority. */
export type AuthorityDebtRecord = Readonly<{
  id: AuthorityDebtId;
  bindingId?: BindingId;
  upstreamAuthority: UpstreamAuthorityReference;
  providerNativeScope: AuthorityScope;
  effectiveScope: AuthorityScope;
  enforcementLayer: "provider" | "gatekeeper" | "contract" | "business-rule-only";
  revocationGranularity: string;
  risk: "low" | "medium" | "high" | "critical";
  exceptionOwner: string;
  productionEligibility: "eligible" | "exceptionRequired" | "ineligible";
  remediation: string;
  lifecycle: "open" | "accepted" | "remediated";
  revision: number;
}>;

/** Terminal identity/lineage retained after executable authority is gone. */
export type AuthorityLifecycleTombstoneRecord = Readonly<{
  id: AuthorityTombstoneId;
  subject:
    | {readonly type: "contractInstance"; readonly id: ContractInstanceId}
    | {readonly type: "binding"; readonly id: BindingId}
    | {readonly type: "runtimeApprovalRequest"; readonly id: RuntimeApprovalRequestId};
  lineage?: AuthorityId<string>;
  terminalReason: string;
  terminalSequence: number;
  cleanup: "pending" | "complete" | "abandoned";
}>;
