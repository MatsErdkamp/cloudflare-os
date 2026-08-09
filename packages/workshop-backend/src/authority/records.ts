import type {WorkpieceId} from "@gadgets/workshop-shared/api";

declare const authorityIdKind: unique symbol;

/** One Workspace-issued opaque identifier. */
export type AuthorityId<Kind extends string> = string & {readonly [authorityIdKind]: Kind};

/** Opaque identities used by canonical Workspace Authority records. */
export type ArtifactApprovalId = AuthorityId<"artifactApproval">;
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
export type AuthorityTombstoneId = AuthorityId<"authorityTombstone">;

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
    | {readonly type: "personalSourceGrant"; readonly id: string; readonly generation: number}
    | {readonly type: "legacyGatekeeper"; readonly workpieceId: WorkpieceId};
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
  | {readonly type: "receipt"; readonly receiptId: string; readonly verifierGeneration: number}
  | {readonly type: "legacyUnknown"};

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

/** An Artifact decision, distinct from installation or possession. */
export type ArtifactApprovalRecord = Readonly<{
  id: ArtifactApprovalId;
  artifactHash: string;
  approvalEpoch: number;
  proposalId?: string;
  reviewBundleHash?: string;
  reviewComparisonHash?: string;
  policyHash?: string;
  evidence: "complete" | "legacyUnknown";
  decision: "approved" | "rejected";
  decidedBy: string;
  permissionGeneration?: number;
  decisionSequence: number;
  lifecycle: "active" | "deprecated" | "revoked";
  revision: number;
}>;

/** A standing placement decision; it never represents Artifact review or task dispatch. */
export type InstallationDecisionRecord = Readonly<{
  id: InstallationDecisionId;
  proposalDigest: string;
  decision: "approved" | "denied" | "expired";
  decidedBy: string;
  permissionGeneration?: number;
  decisionSequence: number;
  consumer?: ConsumerReference;
  requirement?: BindingRequirementReference;
  intendedBindingName?: string;
  expectedBindingGeneration?: number;
  reason?: string;
}>;

/** One immutable per-task decision; it is never an Installation or runtime Approval decision. */
export type TaskDispatchDecisionRecord = Readonly<{
  id: TaskDispatchDecisionId;
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
  parentTaskId?: string;
  absoluteExpiry: number;
  decision: "approved" | "denied";
  decidedBy: string;
  decisionSequence: number;
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
  createdSequence: number;
}>;

/** One prepared executable instance. Its authority tuple never changes after creation. */
export type ContractInstanceRecord = Readonly<{
  id: ContractInstanceId;
  legacyWorkpieceId?: WorkpieceId;
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
  status: "active" | "suspended" | "retracted";
  generation: number;
  revision: number;
  installedSequence: number;
  predecessorId?: BindingId;
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
