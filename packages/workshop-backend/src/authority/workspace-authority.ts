import {collection, createTypedStorage} from "@gadgets/typed-storage";
import {
  validateBindingName,
  type BlueprintBindingAnnotation,
  type WorkpieceId,
} from "@gadgets/workshop-shared/api";
import type {
  AuthorityCommandResult,
  AgentTaskAuthorityView,
  TaskTemplateAuthorityView,
  AuthorityCommandEnvelope,
  AuthorityOwnerCommand,
  AuthorityOwnerCommandResult,
  DecideArtifactProposalCommand,
  CancelAgentTaskCommand,
  InstallStandingBindingCommand,
  StandingBindingInstallationResult,
} from "@gadgets/workshop-shared/authority-api";
import type {
  AuthorityId,
  ArtifactApprovalId,
  ArtifactApprovalRecord,
  ArtifactProposalId,
  ArtifactProposalRecord,
  AuthorityDebtId,
  AuthorityDebtRecord,
  AuthorityLifecycleTombstoneRecord,
  AgentServiceProfileRecord,
  AgentTaskId,
  AgentTaskCancellationRecord,
  AgentTaskOperationalRecord,
  AgentTaskRecord,
  BindingId,
  BindingPublicationPlanId,
  BindingPublicationPlanRecord,
  BindingRecord,
  BindingRequirementReference,
  BindingResolutionId,
  BindingResolutionRecord,
  BindingVerificationReference,
  ConsumerId,
  ConsumerReference,
  ContractInstanceId,
  ContractInstanceRecord,
  InstallationDecisionId,
  InstallationDecisionRecord,
  InvalidationIntentId,
  InvalidationIntentRecord,
  LiveUpstreamAuthorityReference,
  PlacementDecisionReference,
  RuntimeApprovalDecisionId,
  RuntimeApprovalDecisionRecord,
  RuntimeApprovalRequestId,
  RuntimeApprovalRequestRecord,
  SourceId,
  TaskDispatchDecisionId,
  TaskDispatchDecisionRecord,
  TaskEnvironmentRecord,
  TaskTemplateApprovalId,
  TaskTemplateApprovalRecord,
  TaskTemplateVersionRecord,
  RequirementId,
  UpstreamAuthorityReference,
  WorkspacePrincipalRecord,
} from "./records";
import {createConsumerEnvironmentAuthority} from "./consumer-environments";
import type {
  ContractInvalidationAcknowledgement,
  ContractReachabilitySnapshot,
} from "@gadgets/contractors/runtime";
import {validateContractReachabilitySnapshot} from "@gadgets/contractors/host";
import type {
  ProviderAuthorityDescription,
  ProviderAuthorityIdentity,
  ProviderAuthorityLifecycleResult,
} from "@gadgets/workshop-shared/gatekeeper-authority";

const LEGACY_MANAGER_SOURCE_SAMPLE_LIMIT = 16;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const legacyManagerSourceAccessBrand: unique symbol = Symbol("legacyManagerSourceAccess");

function requireContentHash(value: string, field: string): void {
  if (!CONTENT_HASH.test(value)) throw new TypeError(`${field} must be a sha256 content hash.`);
}

function validateArtifactProposal(
  record: Omit<ArtifactProposalRecord, "id" | "state" | "revision">,
): void {
  requireContentHash(record.artifactHash, "Artifact hash");
  requireContentHash(record.runtimeProfileHash, "Runtime Profile hash");
  requireContentHash(record.reviewBundleHash, "Review Bundle hash");
  requireContentHash(record.reviewComparisonHash, "Review Comparison hash");
  requireContentHash(record.policyHash, "Review policy hash");
  requireContentHash(record.generatorIdentityHash, "Generator identity hash");
  if (record.baseline.type === "bundle") {
    requireContentHash(record.baseline.bundleHash, "Baseline Review Bundle hash");
  }
  if (!Number.isSafeInteger(record.proposedAt) || record.proposedAt < 0) {
    throw new TypeError("Artifact Proposal timestamp must be a non-negative safe integer.");
  }
}

function validateArtifactApprovalEvidence(
  storage: AuthorityStorage,
  record: LiveArtifactApprovalInput,
): ArtifactProposalRecord {
  requireContentHash(record.artifactHash, "Artifact hash");
  requireContentHash(record.reviewBundleHash, "Review Bundle hash");
  requireContentHash(record.reviewComparisonHash, "Review Comparison hash");
  requireContentHash(record.policyHash, "Review policy hash");
  requireContentHash(record.generatorIdentityHash, "Generator identity hash");
  if (record.baseline.type === "bundle") {
    requireContentHash(record.baseline.bundleHash, "Baseline Review Bundle hash");
  }
  if (record.proposalId.length === 0) throw new TypeError("Artifact Proposal ID is required.");
  const proposal = storage.artifactProposals.get(record.proposalId);
  if (!proposal || proposal.state !== "pending") {
    throw new Error(`Artifact Proposal is not pending: ${record.proposalId}`);
  }
  const expected = {
    artifactHash: proposal.artifactHash,
    reviewBundleHash: proposal.reviewBundleHash,
    reviewComparisonHash: proposal.reviewComparisonHash,
    policyHash: proposal.policyHash,
    baseline: proposal.baseline,
    generatorIdentityHash: proposal.generatorIdentityHash,
  };
  const actual = {
    artifactHash: record.artifactHash,
    reviewBundleHash: record.reviewBundleHash,
    reviewComparisonHash: record.reviewComparisonHash,
    policyHash: record.policyHash,
    baseline: record.baseline,
    generatorIdentityHash: record.generatorIdentityHash,
  };
  if (!sameAuthorityValue(actual, expected)) {
    throw new Error("Artifact Approval evidence does not match its Proposal.");
  }
  return proposal;
}
const textEncoder = new TextEncoder();

function compositeKey(...parts: readonly (string | number)[]): string {
  return parts.map(part => {
    const value = String(part);
    return `${textEncoder.encode(value).byteLength}:${value}`;
  }).join("");
}

function issueAuthorityId<Kind extends string>(): AuthorityId<Kind> {
  return crypto.randomUUID().toLowerCase() as AuthorityId<Kind>;
}

function digestText(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of textEncoder.encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

type WorkspaceAuthorityState = {
  state: "legacy" | "backfilling" | "readyToCutover" | "active";
  revision: number;
  nextEventSequence: number;
  migrationId?: string;
  cutoverDigest?: string;
  authorityEpoch?: number;
  ownerGeneration?: number;
};

/** Server-minted, generation-bound authorization context for authority administration. */
export type AuthoritySessionBinding = Readonly<{
  principalId: string;
  permissionKind: "owner" | "manager";
  permissionGeneration: number;
  authorityEpoch: number;
}>;

type AuthorityManagerGrant = {
  principalId: string;
  generation: number;
  state: "active" | "revoked";
};

type AuthorityCommandReceipt = {
  key: string;
  requestDigest: string;
  artifactApprovalId: ArtifactApprovalId;
  artifactApprovalEpoch: number;
  decision: "approved" | "rejected";
  sequence: number;
};

type AuthorityOperationRecord = {
  id: string;
  actor: string;
  idempotencyKey: string;
  requestDigest: string;
  state: "begun" | "completed";
  lastCompletedStep?: string;
  result?: AuthorityCommandResult | AuthorityOwnerCommandResult;
};

type AuthorityOwnerCommandReceipt = {
  key: string;
  requestDigest: string;
  generation: number;
  state: "active" | "revoked";
};

type AgentTaskCancellationReceipt = {
  key: string;
  requestDigest: string;
  taskId: AgentTaskId;
  generation: number;
};

type WorkspaceAuthorityEvent = {
  sequence: number;
  type:
    | "authorityModuleInitialized"
    | "artifactProposalRecorded"
    | "artifactApprovalRecorded"
    | "installationDecisionRecorded"
    | "taskDispatchDecisionRecorded"
    | "agentTaskCancellationRequested"
    | "agentServiceProfileChanged"
    | "workspacePrincipalChanged"
    | "taskTemplateVersionRecorded"
    | "taskTemplateApprovalRecorded"
    | "agentTaskDispatched"
    | "agentTaskChanged"
    | "contractInstancePrepared"
    | "contractInstanceRetracted"
    | "authorityEffectCreated"
    | "authorityEffectSucceeded"
    | "authorityEffectDeadLettered"
    | "bindingPublicationPlanned"
    | "invalidationStarted"
    | "bindingPublished"
    | "bindingSuspended"
    | "bindingRetracted"
    | "runtimeApprovalRequested"
    | "runtimeApprovalDecided"
    | "authorityDebtRecorded"
    | "authorityManagerGrantChanged"
    | "hostAuthorityIdentityIssued"
    | "developmentGrantChanged"
    | "developmentSessionChanged"
    | "workloadChanged"
    | "workloadRegistrationChanged"
    | "migrationBaseline";
  revision: number;
  subjectId?: string;
  operationId?: string;
  beforeGeneration?: number;
  afterGeneration?: number;
  migrationBaseline?: {
    digest: string;
    contractCount: number;
    bindingCount: number;
    unknownHistory: true;
  };
};

type WorkspaceAuthorityEffectBase = {
  id: string;
  operationId: string;
  stepKey: string;
  lane: string;
  causalSequence: number;
  inputDigest: string;
  state: "pending" | "claimed" | "retryScheduled" | "outcomeUnknown" |
    "succeeded" | "deadLetter";
  attempt: number;
  firstAttemptAt?: number;
  claimToken?: string;
  claimUntil?: number;
  nextAttemptAt: number;
  reason?: "providerUnavailable" | "claimExpired";
};

type StandingInstallationEffectContext = {
  targetId: ContractInstanceId;
  decisionId: InstallationDecisionId;
  command: InstallStandingBindingCommand;
  principalId: string;
  permissionGeneration: number;
  providerDescription: ProviderAuthorityDescription;
  planId: BindingPublicationPlanId;
  bindingId: BindingId;
  targetBindingGeneration: number;
  phase: "providerPrepare" | "endpointInstall" | "providerActivate" |
    "predecessorInvalidate" | "publish";
  endpointAcknowledgement?: Readonly<{endpointId: string; reachabilityGeneration: number}>;
  cleanupResponsibility: false;
};

/** Exact provider preparation call for an accepted standing installation. */
export type PrepareProviderBackingEffect = WorkspaceAuthorityEffectBase &
  StandingInstallationEffectContext & {kind: "prepareProviderBacking"};

/** Exact Contract Facet endpoint-install call after provider preparation. */
export type InstallContractEndpointEffect = WorkspaceAuthorityEffectBase &
  StandingInstallationEffectContext & {
    kind: "installContractEndpoint";
    providerPrepared: ProviderAuthorityLifecycleResult;
    snapshot: ContractReachabilitySnapshot;
  };

/** Exact provider activation call after durable endpoint acknowledgement. */
export type ActivateProviderBackingEffect = WorkspaceAuthorityEffectBase &
  StandingInstallationEffectContext & {
    kind: "activateProviderBacking";
    providerPrepared: ProviderAuthorityLifecycleResult;
    snapshot: ContractReachabilitySnapshot;
    endpointAcknowledgement: Readonly<{endpointId: string; reachabilityGeneration: number}>;
  };

/** Exact predecessor endpoint invalidation call before replacement publication. */
export type InvalidatePredecessorEffect = WorkspaceAuthorityEffectBase &
  StandingInstallationEffectContext & {
    kind: "invalidatePredecessorEndpoint";
    providerPrepared: ProviderAuthorityLifecycleResult;
    snapshot: ContractReachabilitySnapshot;
    endpointAcknowledgement: Readonly<{endpointId: string; reachabilityGeneration: number}>;
    intentId: InvalidationIntentId;
    predecessorRuntimeWorkpieceId: WorkpieceId;
    predecessorSnapshot: ContractReachabilitySnapshot;
  };

/** One immutable external call in a standing installation chain. */
export type StandingInstallationEffect = PrepareProviderBackingEffect |
  InstallContractEndpointEffect | ActivateProviderBackingEffect | InvalidatePredecessorEffect;

/** One exact, durable external cleanup obligation claimed by the workspace reconciler. */
export type CleanupAuthorityEffect = WorkspaceAuthorityEffectBase & {
  kind: "cleanupProviderBacking" | "cleanupObsoleteContract";
  targetId: ContractInstanceId;
  sourceGatekeeperId: WorkpieceId;
  runtimeWorkpieceId?: WorkpieceId;
  endpointSnapshot?: ContractReachabilitySnapshot;
  expectedProvider: ProviderAuthorityIdentity;
  contractInstance: Readonly<{id: ContractInstanceId; generation: number}>;
  expectedCapabilityGeneration: number;
  deactivationOperationId: string;
  cleanupResponsibility: true;
};

/** Exact Contract endpoint invalidation rooted with a terminal Invalidation Intent. */
export type TerminalInvalidationEffect = WorkspaceAuthorityEffectBase & {
  kind: "invalidateTerminalEndpoint";
  targetId: ContractInstanceId;
  intentId: InvalidationIntentId;
  runtimeWorkpieceId: WorkpieceId;
  endpointSnapshot: ContractReachabilitySnapshot;
  cleanupResponsibility: false;
};

/** One exact external obligation owned by Workspace Authority. */
export type WorkspaceAuthorityEffect = StandingInstallationEffect | CleanupAuthorityEffect |
  TerminalInvalidationEffect;

function isStandingInstallationEffect(
  effect: WorkspaceAuthorityEffect | undefined,
): effect is StandingInstallationEffect {
  return effect?.kind === "prepareProviderBacking" || effect?.kind === "installContractEndpoint" ||
    effect?.kind === "activateProviderBacking" ||
    effect?.kind === "invalidatePredecessorEndpoint";
}

type LegacyManagerSourceUse = {
  chatId: number;
  gatekeeperId: WorkpieceId;
  observedAt: number;
};

type LegacyManagerSourceTelemetry = {
  totalUses: number;
  recentUses: LegacyManagerSourceUse[];
};

type LegacyIdentityMapRecord = {
  key: string;
  canonicalId: string;
};

type HostAuthorityIdentityRecord = {
  key: string;
  kind: "consumer" | "source" | "requirement";
  hostId: WorkpieceId | string;
  canonicalId: string;
  createdSequence: number;
};

type AuthorityMigrationDelta = {
  sequence: number;
  legacyContractId: WorkpieceId;
  kind: "bindingAdded" | "bindingRemoved" | "bindingRenamed" | "contractRetracted";
};

function makeAuthorityStorage(storage: DurableObjectStorage) {
  return createTypedStorage(storage, {
    singletons: {
      workspaceAuthorityState: <WorkspaceAuthorityState | undefined>undefined,
      legacyManagerSourceTelemetry: <LegacyManagerSourceTelemetry>{
        totalUses: 0,
        recentUses: [],
      },
      nextAuthorityMigrationDeltaSequence: 1,
    },
    collections: {
      workspaceAuthorityEvents: collection<WorkspaceAuthorityEvent>()({
        primaryKey: "sequence",
      }),
      hostAuthorityIdentities: collection<HostAuthorityIdentityRecord>()({primaryKey: "key"}),
      workspaceAuthorityEffects: collection<WorkspaceAuthorityEffect>()({
        primaryKey: "id",
        uniqueIndexes: {
          byInstallationOperation(record: WorkspaceAuthorityEffect) {
            return record.kind === "prepareProviderBacking" ? record.operationId : null;
          },
        },
        nonUniqueIndexes: {
          byTarget(record: WorkspaceAuthorityEffect) {
            return record.targetId;
          },
          byState(record: WorkspaceAuthorityEffect) {
            return record.state;
          },
          byDue(record: WorkspaceAuthorityEffect) {
            if (record.state === "succeeded" || record.state === "deadLetter") return null;
            return record.state === "claimed"
              ? record.claimUntil ?? record.nextAttemptAt
              : record.nextAttemptAt;
          },
        },
      }),
      authorityManagerGrants: collection<AuthorityManagerGrant>()({primaryKey: "principalId"}),
      authorityCommandReceipts: collection<AuthorityCommandReceipt>()({primaryKey: "key"}),
      authorityOperations: collection<AuthorityOperationRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byActorKey(record: AuthorityOperationRecord) {
            return compositeKey(record.actor, record.idempotencyKey);
          },
        },
      }),
      authorityOwnerCommandReceipts: collection<AuthorityOwnerCommandReceipt>()({primaryKey: "key"}),
      artifactApprovals: collection<ArtifactApprovalRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byArtifactEpoch(record: ArtifactApprovalRecord) {
            return compositeKey(record.artifactHash, record.approvalEpoch);
          },
          byProposal(record: ArtifactApprovalRecord) {
            return record.evidence === "complete" ? record.proposalId : null;
          },
        },
      }),
      artifactProposals: collection<ArtifactProposalRecord>()({
        primaryKey: "id",
      }),
      installationDecisions: collection<InstallationDecisionRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byOperation(record: InstallationDecisionRecord) {
            return record.operationId;
          },
        },
      }),
      taskDispatchDecisions: collection<TaskDispatchDecisionRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byOperation(record: TaskDispatchDecisionRecord) {
            return record.operationId;
          },
        },
      }),
      agentServiceProfiles: collection<AgentServiceProfileRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byWorkload(record: AgentServiceProfileRecord) {
            return record.lifecycle === "retired" ? null : record.workloadId;
          },
        },
      }),
      workspacePrincipals: collection<WorkspacePrincipalRecord>()({primaryKey: "id"}),
      taskTemplateVersions: collection<TaskTemplateVersionRecord>()({
        primaryKey: "id",
      }),
      taskTemplateApprovals: collection<TaskTemplateApprovalRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byTemplateEpoch(record: TaskTemplateApprovalRecord) {
            return compositeKey(
              record.taskTemplateId,
              record.taskTemplateVersion,
              record.approvalEpoch,
            );
          },
        },
      }),
      agentTasks: collection<AgentTaskRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byDispatch(record: AgentTaskRecord) {
            return record.dispatchDecisionId;
          },
        },
      }),
      agentTaskCancellations: collection<AgentTaskCancellationRecord>()({primaryKey: "taskId"}),
      agentTaskCancellationReceipts:
        collection<AgentTaskCancellationReceipt>()({primaryKey: "key"}),
      agentTaskOperationalState: collection<AgentTaskOperationalRecord>()({primaryKey: "taskId"}),
      taskEnvironments: collection<TaskEnvironmentRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byTaskGeneration(record: TaskEnvironmentRecord) {
            return compositeKey(record.taskId, record.generation);
          },
        },
      }),
      bindingResolutions: collection<BindingResolutionRecord>()({
        primaryKey: "id",
      }),
      contractInstances: collection<ContractInstanceRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byLegacyWorkpieceId(record: ContractInstanceRecord) {
            return record.legacyWorkpieceId ?? null;
          },
          byPlacementDecision(record: ContractInstanceRecord) {
            return compositeKey(
              record.placementDecision.type,
              record.placementDecision.decisionId,
              record.intendedRequirement?.requirementId ?? "",
            );
          },
        },
        nonUniqueIndexes: {
          byArtifactApproval(record: ContractInstanceRecord) {
            return record.artifactApprovalId;
          },
        },
      }),
      bindings: collection<BindingRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          currentByConsumerName(record: BindingRecord) {
            return record.status !== "retracted"
              ? compositeKey(record.consumer.consumerId, record.name)
              : null;
          },
        },
        nonUniqueIndexes: {
          byInstance(record: BindingRecord) {
            return record.contractInstanceId;
          },
          byConsumer(record: BindingRecord) {
            return record.consumer.consumerId;
          },
        },
      }),
      bindingPublicationPlans: collection<BindingPublicationPlanRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byOperation(record: BindingPublicationPlanRecord) {
            return record.operationId;
          },
        },
      }),
      invalidationIntents: collection<InvalidationIntentRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byPlan(record: InvalidationIntentRecord) {
            return record.planId ?? null;
          },
          byOperation(record: InvalidationIntentRecord) {
            return record.operationId;
          },
        },
        nonUniqueIndexes: {
          byBinding(record: InvalidationIntentRecord) {
            return record.bindingId;
          },
        },
      }),
      runtimeApprovalRequests: collection<RuntimeApprovalRequestRecord>()({
        primaryKey: "id",
      }),
      runtimeApprovalDecisions: collection<RuntimeApprovalDecisionRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byRequest(record: RuntimeApprovalDecisionRecord) {
            return record.requestId;
          },
        },
      }),
      authorityDebts: collection<AuthorityDebtRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byBinding(record: AuthorityDebtRecord) {
            return record.bindingId ?? null;
          },
        },
      }),
      authorityTombstones: collection<AuthorityLifecycleTombstoneRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          bySubject(record: AuthorityLifecycleTombstoneRecord) {
            return compositeKey(record.subject.type, record.subject.id);
          },
        },
      }),
      legacyIdentityMap: collection<LegacyIdentityMapRecord>()({
        primaryKey: "key",
      }),
      authorityMigrationDeltas: collection<AuthorityMigrationDelta>()({
        primaryKey: "sequence",
        nonUniqueIndexes: {
          byContract(record: AuthorityMigrationDelta) {
            return record.legacyContractId;
          },
        },
      }),
    },
  });
}

type AuthorityStorage = ReturnType<typeof makeAuthorityStorage>;

type LiveArtifactApprovalInput = Omit<
  Extract<ArtifactApprovalRecord, {evidence: "complete"}>,
  "id" | "approvalEpoch" | "decisionSequence" | "revision"
>;

export type LiveInstallationDecisionInput = Omit<
  InstallationDecisionRecord,
  | "id"
  | "operationId"
  | "decisionSequence"
  | "consumer"
  | "requirement"
  | "intendedBindingName"
  | "expectedBindingGeneration"
> & (
  | {
      decision: "approved";
      consumer: ConsumerReference;
      requirement: BindingRequirementReference;
      intendedBindingName: string;
      expectedBindingGeneration: number;
    }
  | {decision: "denied" | "expired"}
);

type LiveContractInstanceInput = Omit<
  ContractInstanceRecord,
  | "id"
  | "legacyWorkpieceId"
  | "upstreamAuthority"
  | "lifecycle"
  | "generation"
  | "revision"
  | "createdSequence"
> & {upstreamAuthority: LiveUpstreamAuthorityReference};

type LiveBindingVerification = Exclude<BindingVerificationReference, {type: "legacyUnknown"}>;

/** Exact, capability-free request to materialize one bounded Agent Task dispatch. */
export type MaterializeAgentTaskDispatchInput = Readonly<{
  operationId: string;
  intentDigest: string;
  taskTemplateApprovalId: TaskTemplateApprovalId;
  agentServiceProfileId: string;
  expectedAgentServiceProfileGeneration: number;
  agentService: Readonly<{
    workloadId: string;
    workloadGeneration: number;
    workloadConsumer: Extract<ConsumerReference, {type: "standing"}>;
    workloadRegistrationId: string;
    workloadRegistrationGeneration: number;
  }>;
  principal: Readonly<{id: string; generation: number}>;
  requestedAt: number;
  applicationScope?: Readonly<{
    kind: "workspaceApplication";
    scopeId: string;
    scopeGeneration: number;
  }>;
}>;

/** A closed mutation accepted by the in-process Workspace Authority module. */
export type WorkspaceAuthorityCommand =
  | {type: "initialize"}
  | {type: "beginBackfill"; migrationId: string}
  | {type: "backfillLegacyContract"; legacyContractId: WorkpieceId}
  | {type: "markReadyToCutover"; expectedDigest: string}
  | {type: "cutover"; expectedDigest: string}
  | {
      type: "recordArtifactProposal";
      operationId: string;
      record: Omit<ArtifactProposalRecord, "id" | "state" | "revision">;
    }
  | {
      type: "recordInstallationDecision";
      operationId: string;
      record: LiveInstallationDecisionInput;
    }
  | {
      type: "recordTaskDispatchDecision";
      operationId: string;
      record: Omit<TaskDispatchDecisionRecord, "id" | "operationId" | "decisionSequence">;
    }
  | {type: "recordAgentServiceProfile"; record: AgentServiceProfileRecord}
  | {type: "recordWorkspacePrincipal"; record: WorkspacePrincipalRecord}
  | {
      type: "recordTaskTemplateVersion";
      record: Omit<TaskTemplateVersionRecord, "id">;
    }
  | {
      type: "recordTaskTemplateApproval";
      record: Omit<TaskTemplateApprovalRecord, "id">;
    }
  | {type: "materializeAgentTaskDispatch"; input: MaterializeAgentTaskDispatchInput}
  | {type: "recordAgentTaskOperationalState"; record: AgentTaskOperationalRecord}
  | {
      type: "terminateUnpublishedAgentTask";
      operationId: string;
      taskId: AgentTaskId;
      expectedTaskGeneration: number;
      lifecycle: "completed" | "failed" | "cancelled" | "expired";
    }
  | {
      type: "prepareContractInstance";
      operationId: string;
      record: LiveContractInstanceInput;
    }
  | {
      type: "recordProviderBacking";
      operationId: string;
      contractInstanceId: ContractInstanceId;
      expectedInstanceGeneration: number;
      description: ProviderAuthorityDescription;
      result: ProviderAuthorityLifecycleResult;
    }
  | {
      type: "planBindingPublication";
      operationId: string;
      contractInstanceId: ContractInstanceId;
      consumer: ConsumerReference;
      requirement: BindingRequirementReference;
      name: string;
      verification: LiveBindingVerification;
      expectedBindingGeneration: number;
      evaluatorPolicyHash: string;
    }
  | {
      type: "acknowledgeBindingEndpoint";
      operationId: string;
      planId: BindingPublicationPlanId;
      snapshot: ContractReachabilitySnapshot;
      acknowledgement: Readonly<{endpointId: string; reachabilityGeneration: number}>;
    }
  | {
      type: "acknowledgeBindingInvalidation";
      operationId: string;
      planId: BindingPublicationPlanId;
      acknowledgement: ContractInvalidationAcknowledgement;
    }
  | {
      type: "commitBindingPublication";
      operationId: string;
      planId: BindingPublicationPlanId;
    }
  | {
      type: "beginBindingInvalidation";
      operationId: string;
      bindingId: BindingId;
      expectedGeneration: number;
      terminalTarget: "suspended" | "retracted";
      reason: string;
    }
  | {
      type: "acknowledgeTerminalBindingInvalidation";
      operationId: string;
      intentId: InvalidationIntentId;
      acknowledgement: ContractInvalidationAcknowledgement;
    }
  | {
      type: "commitTerminalBindingInvalidation";
      operationId: string;
      intentId: InvalidationIntentId;
    }
  | {
      type: "requestRuntimeApproval";
      operationId: string;
      record: Omit<RuntimeApprovalRequestRecord, "id" | "state" | "revision">;
    }
  | {
      type: "decideRuntimeApproval";
      operationId: string;
      record: Omit<RuntimeApprovalDecisionRecord, "id">;
    }
  | {
      type: "recordAuthorityDebt";
      operationId: string;
      record: Omit<AuthorityDebtRecord, "id" | "revision">;
    }
  | {type: "mapLegacyConsumer"; legacyWorkpieceId: WorkpieceId}
  | {type: "mapLegacySource"; legacyWorkpieceId: WorkpieceId}
  | {type: "mapLegacyRequirement"; legacyKey: string};

/** The result of a Workspace Authority mutation. */
export type WorkspaceAuthorityCommandResult =
  | {type: "initialized"; changed: boolean; revision: number}
  | {type: "backfillStarted"; changed: boolean; revision: number}
  | {type: "legacyContractBackfilled"; instanceId: ContractInstanceId; changed: boolean}
  | {type: "readyToCutover"; digest: string; revision: number}
  | {type: "cutoverCompleted"; digest: string; sequence: number; revision: number}
  | {type: "artifactProposalRecorded"; id: ArtifactProposalId; sequence: number}
  | {
      type: "artifactApprovalRecorded";
      id: ArtifactApprovalId;
      approvalEpoch: number;
      sequence: number;
    }
  | {type: "installationDecisionRecorded"; id: InstallationDecisionId; sequence: number}
  | {type: "taskDispatchDecisionRecorded"; id: TaskDispatchDecisionId; sequence: number}
  | {type: "agentServiceProfileRecorded"; id: string; generation: number}
  | {type: "workspacePrincipalRecorded"; id: string; generation: number}
  | {type: "taskTemplateVersionRecorded"; id: string}
  | {type: "taskTemplateApprovalRecorded"; id: TaskTemplateApprovalId}
  | {type: "agentTaskOperationalStateRecorded"; taskId: AgentTaskId; revision: number}
  | {
      type: "agentTaskDispatched";
      taskId: AgentTaskId;
      dispatchDecisionId: TaskDispatchDecisionId;
      environmentId: string;
    }
  | {type: "agentTaskTerminated"; taskId: AgentTaskId; generation: number}
  | {type: "contractInstancePrepared"; id: ContractInstanceId; sequence: number}
  | {type: "providerBackingRecorded"; id: ContractInstanceId; capabilityGeneration: number}
  | {
      type: "bindingPublicationPlanned";
      planId: BindingPublicationPlanId;
      bindingId: BindingId;
      resolutionId: BindingResolutionId;
      generation: number;
    }
  | {
      type: "bindingEndpointAcknowledged";
      planId: BindingPublicationPlanId;
      invalidationIntentId?: InvalidationIntentId;
    }
  | {type: "bindingInvalidationAcknowledged"; planId: BindingPublicationPlanId}
  | {
      type: "bindingPublished";
      bindingId: BindingId;
      resolutionId: BindingResolutionId;
      generation: number;
      sequence: number;
    }
  | {type: "bindingPublicationObsolete"; planId: BindingPublicationPlanId; reason: "staleCas"}
  | {type: "bindingInvalidationPlanned"; intentId: InvalidationIntentId}
  | {type: "terminalBindingInvalidationAcknowledged"; intentId: InvalidationIntentId}
  | {type: "bindingSuspended" | "bindingRetracted"; generation: number; sequence: number}
  | {type: "runtimeApprovalRequested"; id: RuntimeApprovalRequestId; sequence: number}
  | {type: "runtimeApprovalDecided"; id: RuntimeApprovalDecisionId; sequence: number}
  | {type: "authorityDebtRecorded"; id: AuthorityDebtId; sequence: number}
  | {type: "legacyConsumerMapped"; id: ConsumerId}
  | {type: "legacySourceMapped"; id: SourceId}
  | {type: "legacyRequirementMapped"; id: RequirementId};

/** A closed read accepted by the in-process Workspace Authority module. */
export type WorkspaceAuthorityQuery =
  | {type: "status"}
  | {type: "cutoverCandidate"}
  | {type: "artifactProposal"; id: ArtifactProposalId}
  | {type: "artifactApproval"; id: ArtifactApprovalId}
  | {type: "artifactApprovalByProposal"; proposalId: ArtifactProposalId}
  | {type: "installationDecision"; id: InstallationDecisionId}
  | {type: "installationDecisionByOperation"; operationId: string}
  | {type: "taskDispatchDecision"; id: TaskDispatchDecisionId}
  | {type: "agentServiceProfile"; id: string}
  | {type: "workspacePrincipal"; id: string}
  | {type: "taskTemplateVersion"; id: string}
  | {type: "taskTemplateApproval"; id: TaskTemplateApprovalId}
  | {type: "agentTask"; id: AgentTaskId}
  | {type: "taskEnvironment"; taskId: AgentTaskId; generation: number}
  | {type: "contractInstance"; id: ContractInstanceId}
  | {type: "binding"; id: BindingId}
  | {type: "bindingByConsumerName"; consumerId: ConsumerId; name: string}
  | {type: "bindingByInstance"; contractInstanceId: ContractInstanceId}
  | {type: "bindingResolution"; id: BindingResolutionId}
  | {type: "bindingPublicationPlan"; id: BindingPublicationPlanId}
  | {type: "invalidationIntentByPlan"; planId: BindingPublicationPlanId}
  | {type: "invalidationIntentByOperation"; operationId: string}
  | {type: "bindingExecution"; consumerId: ConsumerId; name: string}
  | {type: "bindingExecutionByInstance"; contractInstanceId: ContractInstanceId}
  | {type: "consumerReadiness"; consumerId: ConsumerId}
  | {type: "consumerEnvironment"; consumerId: ConsumerId}
  | {type: "runtimeApprovalRequest"; id: RuntimeApprovalRequestId}
  | {type: "runtimeApprovalDecision"; id: RuntimeApprovalDecisionId}
  | {type: "authorityDebt"; id: AuthorityDebtId}
  | {type: "authorityDebtByBinding"; bindingId: BindingId}
  | {
      type: "authorityTombstoneBySubject";
      subjectType: AuthorityLifecycleTombstoneRecord["subject"]["type"];
      subjectId: string;
    };

/** A bounded operational view of the Workspace Authority module. */
export type WorkspaceAuthorityStatus = {
  state: "uninitialized" | WorkspaceAuthorityState["state"];
  revision: number;
  eventHighWatermark: number;
  pendingEffects: number;
  pendingMigrationDeltas: number;
  cutoverDigest?: string;
};

/** A discriminated bounded query result. */
export type WorkspaceAuthorityQueryResult =
  | {type: "status"; value: WorkspaceAuthorityStatus}
  | {type: "cutoverCandidate"; value: {digest: string; contractCount: number; bindingCount: number}}
  | {type: "artifactProposal"; value?: ArtifactProposalRecord}
  | {type: "artifactApproval"; value?: ArtifactApprovalRecord}
  | {type: "artifactApprovalByProposal"; value?: ArtifactApprovalRecord}
  | {type: "installationDecision"; value?: InstallationDecisionRecord}
  | {type: "installationDecisionByOperation"; value?: InstallationDecisionRecord}
  | {type: "taskDispatchDecision"; value?: TaskDispatchDecisionRecord}
  | {type: "agentServiceProfile"; value?: AgentServiceProfileRecord}
  | {type: "workspacePrincipal"; value?: WorkspacePrincipalRecord}
  | {type: "taskTemplateVersion"; value?: TaskTemplateVersionRecord}
  | {type: "taskTemplateApproval"; value?: TaskTemplateApprovalRecord}
  | {type: "agentTask"; value?: AgentTaskRecord}
  | {type: "taskEnvironment"; value?: TaskEnvironmentRecord}
  | {type: "contractInstance"; value?: ContractInstanceRecord}
  | {type: "binding"; value?: BindingRecord}
  | {type: "bindingByConsumerName"; value?: BindingRecord}
  | {type: "bindingByInstance"; value?: BindingRecord}
  | {type: "bindingResolution"; value?: BindingResolutionRecord}
  | {type: "bindingPublicationPlan"; value?: BindingPublicationPlanRecord}
  | {type: "invalidationIntentByPlan"; value?: InvalidationIntentRecord}
  | {type: "invalidationIntentByOperation"; value?: InvalidationIntentRecord}
  | {type: "bindingExecution"; value?: Readonly<{binding: BindingRecord; instance: ContractInstanceRecord}>}
  | {type: "bindingExecutionByInstance"; value?: Readonly<{binding: BindingRecord; instance: ContractInstanceRecord}>}
  | {type: "consumerReadiness"; value: Readonly<{ready: boolean; generation: number}>}
  | {
      type: "consumerEnvironment";
      value: Readonly<{
        ready: boolean;
        generation: number;
        bindings: readonly Readonly<{
          binding: BindingRecord;
          instance: ContractInstanceRecord;
          resolution: BindingResolutionRecord;
        }>[];
      }>;
    }
  | {type: "runtimeApprovalRequest"; value?: RuntimeApprovalRequestRecord}
  | {type: "runtimeApprovalDecision"; value?: RuntimeApprovalDecisionRecord}
  | {type: "authorityDebt"; value?: AuthorityDebtRecord}
  | {type: "authorityDebtByBinding"; value?: AuthorityDebtRecord}
  | {type: "authorityTombstoneBySubject"; value?: AuthorityLifecycleTombstoneRecord};

/** The result of one bounded reconciliation pass. */
export type WorkspaceAuthorityReconciliationResult = {attemptedEffects: number};

/**
 * The small in-process seam used by the Workspace aggregate host and its tests.
 *
 * Storage layout, event sequencing, effect records, migrations, and readiness transitions stay
 * inside the implementation. RPC adapters must translate into these closed commands and queries.
 */
export interface WorkspaceAuthority {
  execute(command: WorkspaceAuthorityCommand): WorkspaceAuthorityCommandResult;
  query(query: WorkspaceAuthorityQuery): WorkspaceAuthorityQueryResult;
  reconcile(): WorkspaceAuthorityReconciliationResult;
  claimDueEffects(
    now: number,
    limit: number,
    createClaimToken: () => string,
  ): readonly WorkspaceAuthorityEffect[];
  startStandingInstallationEffect(input: Readonly<{
    command: InstallStandingBindingCommand;
    requestDigest: string;
    decision: InstallationDecisionRecord;
    contractInstanceId: ContractInstanceId;
    providerDescription: ProviderAuthorityDescription;
  }>): StandingInstallationEffect;
  advanceStandingInstallationEffect(
    effectId: string,
    claimToken: string,
    phase: StandingInstallationEffect["phase"],
  ): void;
  recordStandingInstallationEndpointOutcome(
    effectId: string,
    claimToken: string,
    acknowledgement: Readonly<{endpointId: string; reachabilityGeneration: number}>,
  ): void;
  completeProviderPreparationEffect(
    effectId: string,
    claimToken: string,
    result: ProviderAuthorityLifecycleResult,
    snapshot: ContractReachabilitySnapshot,
    debt: Omit<AuthorityDebtRecord, "id" | "revision">,
  ): void;
  completeEndpointInstallationEffect(
    effectId: string,
    claimToken: string,
    acknowledgement: Readonly<{endpointId: string; reachabilityGeneration: number}>,
  ): void;
  completeProviderActivationEffect(
    effectId: string,
    claimToken: string,
    result: ProviderAuthorityLifecycleResult,
  ): StandingBindingInstallationResult | undefined;
  completeStandingInstallationEffect(
    effectId: string,
    claimToken: string,
    result: StandingBindingInstallationResult,
  ): void;
  completeTerminalInvalidationEffect(
    effectId: string,
    claimToken: string,
    acknowledgement: ContractInvalidationAcknowledgement,
  ): void;
  completeEffect(effectId: string, claimToken: string): void;
  retryEffect(effectId: string, claimToken: string, now: number): void;
  nextEffectDueAt(): number | undefined;
  resolveLegacyIdentity(
    kind: "consumer" | "source" | "requirement",
    legacyId: WorkpieceId | string,
  ): string | undefined;
  ensureHostIdentity(
    kind: "consumer" | "source" | "requirement",
    hostId: WorkpieceId | string,
  ): string;
  recordConsumerLifecycleEvent(event: Readonly<{
    type: "developmentGrantChanged" | "developmentSessionChanged" |
      "workloadChanged" | "workloadRegistrationChanged";
    subjectId: string;
    operationId?: string;
    beforeGeneration?: number;
    afterGeneration?: number;
  }>): void;
  openSession(principalId: string, isOwner: boolean): AuthoritySessionBinding | undefined;
  beginOperation(
    session: AuthoritySessionBinding,
    idempotencyKey: string,
    requestDigest: string,
  ): AuthorityOperationRecord;
  getOperation(session: AuthoritySessionBinding, operationId: string): AuthorityOperationRecord | undefined;
  hasReviewEvidence(
    session: AuthoritySessionBinding,
    bundleHash: string,
    comparisonHash: string,
  ): boolean;
  decideArtifactProposal(
    session: AuthoritySessionBinding,
    command: DecideArtifactProposalCommand,
    requestDigest: string,
  ): Extract<WorkspaceAuthorityCommandResult, {type: "artifactApprovalRecorded"}>;
  requestAgentTaskCancellation(
    session: AuthoritySessionBinding,
    command: CancelAgentTaskCommand,
    requestDigest: string,
  ): Extract<AuthorityCommandResult, {type: "agentTaskCancellationRequested"}>;
  listAgentTaskAuthorityViews(session: AuthoritySessionBinding): readonly AgentTaskAuthorityView[];
  listTaskTemplateAuthorityViews(session: AuthoritySessionBinding): readonly TaskTemplateAuthorityView[];
  recordStandingInstallationDecision(
    session: AuthoritySessionBinding,
    command: InstallStandingBindingCommand,
    requestDigest: string,
    record: LiveInstallationDecisionInput,
  ): InstallationDecisionRecord;
  acceptStandingInstallation(input: Readonly<{
    session: AuthoritySessionBinding;
    command: InstallStandingBindingCommand;
    requestDigest: string;
    decision: LiveInstallationDecisionInput;
    instance: Omit<LiveContractInstanceInput, "placementDecision">;
    providerDescription: ProviderAuthorityDescription;
  }>): Readonly<{
    decision: InstallationDecisionRecord;
    contractInstanceId: ContractInstanceId;
    effect: StandingInstallationEffect;
  }>;
  setManagerGrant(
    ownerSession: AuthoritySessionBinding,
    command: AuthorityOwnerCommand,
    requestDigest: string,
  ): Readonly<{principalId: string; generation: number; state: "active" | "revoked"}>;
}

/** One legacy Gadget binding edge retained only until canonical Binding cutover. */
export type LegacyGadgetBindingRecord = {
  target: WorkpieceId;
  blueprintAnnotation?: BlueprintBindingAnnotation;
  pending?: {chatId: number; sequence?: number};
};

/** The minimum legacy Gadget record used by the compatibility adapter. */
export type LegacyGadgetAuthorityRecord = {
  id: WorkpieceId;
  title: string;
  bindings: Record<string, LegacyGadgetBindingRecord>;
};

/** Existing Workspace storage behavior required by the temporary Gadget compatibility adapter. */
export interface LegacyWorkspaceAuthorityAdapter<
  Gadget extends LegacyGadgetAuthorityRecord = LegacyGadgetAuthorityRecord,
> {
  getGadget(id: WorkpieceId): Gadget | undefined;
  listGadgets(): Iterable<Gadget>;
  putGadget(gadget: Gadget): void;
  hasContract(id: WorkpieceId): boolean;
  hasGatekeeper(id: WorkpieceId): boolean;
  getContract(id: WorkpieceId): LegacyContractAuthorityRecord | undefined;
  listContracts(): Iterable<LegacyContractAuthorityRecord>;
  getContractTombstone(id: WorkpieceId): LegacyContractAuthorityRecord | undefined;
  listContractTombstones(): Iterable<LegacyContractAuthorityRecord>;
  retractContract(id: WorkpieceId): readonly WorkpieceId[];
  bumpConsumers(ids: readonly WorkpieceId[]): void;
}

/** The legacy combined Contract row consumed only by shadow backfill. */
export type LegacyContractAuthorityRecord = Readonly<{
  id: WorkpieceId;
  artifactHash: string;
  runtimeProfileHash: string;
  sourceGatekeeperId: WorkpieceId;
  approvedBy: string;
  sharedStateKey?: string;
}>;

/** An opaque proof that the legacy Manager authoring path passed its rollout guard. */
export interface LegacyManagerSourceAccess {
  readonly gatekeeperId: WorkpieceId;
  readonly chatId: number;
  readonly [legacyManagerSourceAccessBrand]: true;
}

/** Bounded durable telemetry for the legacy Manager Source path. */
export type LegacyManagerSourceTelemetryView = Readonly<{
  totalUses: number;
  recentUses: readonly Readonly<LegacyManagerSourceUse>[];
}>;

/**
 * Temporary adapter for pre-cutover Gadget bindings and Manager authoring Sources.
 *
 * This interface is intentionally separate from {@link WorkspaceAuthority}; no Authority Session,
 * Consumer Environment, Task Template, Task Dispatch, or Agent Task adapter may receive it.
 */
export interface LegacyWorkspaceAuthorityCompatibility {
  queryVisibleBindings(request: {
    consumerId: WorkpieceId;
    forChatId?: number;
  }): [string, LegacyGadgetBindingRecord][];
  bindContract(request: {
    consumerId: WorkpieceId;
    name: string;
    contractId: WorkpieceId;
    chatId?: number;
  }): void;
  unbind(request: {consumerId: WorkpieceId; name: string; forChatId?: number}): void;
  renameBinding(request: {
    consumerId: WorkpieceId;
    oldName: string;
    newName: string;
  }): void;
  retractContract(contractId: WorkpieceId): void;
  authorizeLegacyManagerSource(request: {
    surface: "managerAgentAuthoring";
    chatId: number;
    gatekeeperId: WorkpieceId;
  }): LegacyManagerSourceAccess;
  consumeLegacyManagerSourceAccess(access: LegacyManagerSourceAccess): Readonly<{
    chatId: number;
    gatekeeperId: WorkpieceId;
  }>;
  queryLegacyManagerSourceTelemetry(): LegacyManagerSourceTelemetryView;
}

/** Both deliberately disjoint interfaces implemented inside the Workspace aggregate. */
export type WorkspaceAuthorityModule = {
  authority: WorkspaceAuthority;
  compatibility: LegacyWorkspaceAuthorityCompatibility;
};

function status(storage: AuthorityStorage): WorkspaceAuthorityStatus {
  const state = storage.workspaceAuthorityState.get();
  let pendingEffects = 0;
  for (const effect of storage.workspaceAuthorityEffects.list()) {
    if (effect.state !== "succeeded") pendingEffects++;
  }
  return {
    state: state?.state ?? "uninitialized",
    revision: state?.revision ?? 0,
    eventHighWatermark: state ? state.nextEventSequence - 1 : 0,
    pendingEffects,
    pendingMigrationDeltas: [...storage.authorityMigrationDeltas.list()].length,
    ...(state?.cutoverDigest ? {cutoverDigest: state.cutoverDigest} : {}),
  };
}

function effectRetryDelay(effectId: string, attempt: number): number {
  let hash = 2166136261;
  for (const character of `${effectId}:${attempt}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const jitter = 0.75 + ((hash >>> 0) / 0xffffffff) * 0.5;
  return Math.floor(Math.min(5_000 * (2 ** Math.max(0, attempt - 1)), 15 * 60_000) * jitter);
}

function requireAuthorityState(storage: AuthorityStorage): WorkspaceAuthorityState {
  const state = storage.workspaceAuthorityState.get();
  if (!state) throw new Error("Workspace Authority is not initialized.");
  return state;
}

function requireActiveAuthority(storage: AuthorityStorage): WorkspaceAuthorityState {
  const state = requireAuthorityState(storage);
  if (state.state !== "active") {
    throw new Error("Canonical Workspace Authority is not active.");
  }
  return state;
}

function appendAuthorityEvent(
  storage: AuthorityStorage,
  event: Omit<WorkspaceAuthorityEvent, "sequence" | "revision">,
): number {
  const current = storage.workspaceAuthorityState.get();
  if (!current) throw new Error("Workspace Authority is not initialized.");
  const sequence = current.nextEventSequence;
  const revision = current.revision + 1;
  storage.workspaceAuthorityState.put({
    ...current,
    revision,
    nextEventSequence: sequence + 1,
  });
  storage.workspaceAuthorityEvents.put({...event, sequence, revision});
  return sequence;
}

function canonicalAuthorityValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAuthorityValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, child]) => [key, canonicalAuthorityValue(child)]));
  }
  return value;
}

function sameAuthorityValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalAuthorityValue(left)) ===
    JSON.stringify(canonicalAuthorityValue(right));
}

function validatePublicationSnapshot(
  plan: BindingPublicationPlanRecord,
  instance: ContractInstanceRecord,
  snapshot: ContractReachabilitySnapshot,
): ContractReachabilitySnapshot {
  const exact = validateContractReachabilitySnapshot(snapshot);
  const endpointId = `contract-instance:${instance.id}`;
  if (exact.endpointId !== endpointId || exact.instanceId !== instance.id ||
      exact.instanceGeneration !== instance.generation ||
      exact.artifactHash !== instance.artifactHash ||
      exact.runtimeProfileHash !== instance.runtimeProfileHash ||
      exact.reachabilityId !== `binding:${plan.bindingId}` ||
      exact.reachabilityGeneration !== plan.targetBindingGeneration ||
      exact.chainDepth !== 0 || exact.maxChainDepth !== 8 ||
      !sameAuthorityValue(exact.compositionLineage, [endpointId])) {
    throw new Error("Binding endpoint acknowledgement differs from its canonical publication plan.");
  }
  requireContentHash(exact.authoritySnapshotDigest, "Authority snapshot digest");
  return exact;
}

function requireActiveApproval(
  storage: AuthorityStorage,
  id: ArtifactApprovalId,
): ArtifactApprovalRecord {
  const approval = storage.artifactApprovals.get(id);
  if (!approval || approval.decision !== "approved" || approval.lifecycle !== "active") {
    throw new Error(`Artifact Approval is not active: ${id}`);
  }
  return approval;
}

function validatePlacementDecision(
  storage: AuthorityStorage,
  placement: PlacementDecisionReference,
): InstallationDecisionRecord | TaskDispatchDecisionRecord {
  if (placement.type === "taskDispatch") {
    const decision = storage.taskDispatchDecisions.get(placement.decisionId);
    if (!decision || decision.decision !== "approved") {
      throw new Error(`Task Dispatch Decision is not approved: ${placement.decisionId}`);
    }
    if (decision.absoluteExpiry <= Date.now()) {
      throw new Error(`Task Dispatch Decision is expired: ${placement.decisionId}`);
    }
    return decision;
  } else {
    const decision = storage.installationDecisions.get(placement.decisionId);
    if (!decision || decision.decision !== "approved") {
      throw new Error(`Installation Decision is not approved: ${placement.decisionId}`);
    }
    return decision;
  }
}

function mapLegacyIdentity<Kind extends string>(
  storage: AuthorityStorage,
  kind: Kind,
  legacyId: string | number,
): AuthorityId<Kind> {
  const key = compositeKey(kind, legacyId);
  const existing = storage.legacyIdentityMap.get(key);
  if (existing) return existing.canonicalId as AuthorityId<Kind>;
  const canonicalId = issueAuthorityId<Kind>();
  storage.legacyIdentityMap.put({key, canonicalId});
  return canonicalId;
}

function findMappedLegacyIdentity<Kind extends string>(
  storage: AuthorityStorage,
  kind: Kind,
  legacyId: string | number,
): AuthorityId<Kind> | undefined {
  const existing = storage.legacyIdentityMap.get(compositeKey(kind, legacyId));
  return existing?.canonicalId as AuthorityId<Kind> | undefined;
}

function migrationSnapshot(storage: AuthorityStorage): {
  digest: string;
  contractCount: number;
  bindingCount: number;
} {
  const records = [
    ...storage.artifactApprovals.list(),
    ...storage.installationDecisions.list(),
    ...storage.taskDispatchDecisions.list(),
    ...storage.contractInstances.list(),
    ...storage.bindingResolutions.list(),
    ...storage.bindings.list(),
    ...storage.legacyIdentityMap.list(),
  ];
  return {
    digest: digestText(JSON.stringify(records)),
    contractCount: [...storage.contractInstances.list()].length,
    bindingCount: [...storage.bindings.list()].filter(binding => binding.status !== "retracted").length,
  };
}

function findLegacyPlacement<Gadget extends LegacyGadgetAuthorityRecord>(
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
  contractId: WorkpieceId,
): {gadget: Gadget; name: string; edge: LegacyGadgetBindingRecord} | undefined {
  let result: {gadget: Gadget; name: string; edge: LegacyGadgetBindingRecord} | undefined;
  for (const gadget of adapter.listGadgets()) {
    for (const [name, edge] of Object.entries(gadget.bindings)) {
      if (edge.target !== contractId) continue;
      if (edge.pending) {
        throw new Error(`Cannot backfill pending legacy Binding ${gadget.id}.${name}.`);
      }
      if (result) throw new Error(`Legacy Contract ${contractId} has more than one placement.`);
      result = {gadget, name, edge};
    }
  }
  return result;
}

function appendMigrationDelta(
  storage: AuthorityStorage,
  legacyContractId: WorkpieceId,
  kind: AuthorityMigrationDelta["kind"],
): void {
  const state = requireAuthorityState(storage);
  if (state.state !== "backfilling" && state.state !== "readyToCutover") return;
  const sequence = storage.nextAuthorityMigrationDeltaSequence.get();
  storage.nextAuthorityMigrationDeltaSequence.put(sequence + 1);
  storage.authorityMigrationDeltas.put({sequence, legacyContractId, kind});
  if (state.state === "readyToCutover") {
    const {cutoverDigest: _cutoverDigest, ...withoutDigest} = state;
    storage.workspaceAuthorityState.put({
      ...withoutDigest,
      state: "backfilling",
      revision: state.revision + 1,
    });
  }
}

function discardStagedContract(storage: AuthorityStorage, instance: ContractInstanceRecord): void {
  const stagedBindings = Array.from(storage.bindings.byInstance.get(instance.id));
  for (const binding of stagedBindings) {
    storage.bindingResolutions.delete(binding.resolutionId);
    storage.bindings.delete(binding.id);
  }
  storage.authorityTombstones.bySubject.delete(compositeKey("contractInstance", instance.id));
  storage.contractInstances.delete(instance.id);
  storage.artifactApprovals.delete(instance.artifactApprovalId);
  if (instance.placementDecision.type === "installation") {
    storage.installationDecisions.delete(instance.placementDecision.decisionId);
  }
}

function transitionContractInstance(
  storage: AuthorityStorage,
  instanceId: ContractInstanceId,
  lifecycle: "suspended" | "retracted",
  sequence: number,
  reason: string,
): void {
  const instance = storage.contractInstances.get(instanceId);
  if (!instance) throw new Error(`No Contract Instance for Binding: ${instanceId}`);
  storage.contractInstances.put({
    ...instance,
    lifecycle,
    generation: instance.generation + 1,
    revision: instance.revision + 1,
  });
  if (lifecycle === "retracted") {
    storage.authorityTombstones.put({
      id: issueAuthorityId<"authorityTombstone">(),
      subject: {type: "contractInstance", id: instance.id},
      lineage: instance.predecessorId,
      terminalReason: reason,
      terminalSequence: sequence,
      cleanup: "pending",
    });
  }
}

function rootProviderCleanupEffect(
  storage: AuthorityStorage,
  instance: ContractInstanceRecord,
  binding: BindingRecord,
  operationId: string,
  invalidateEndpoint = false,
): void {
  if (!instance.providerBacking || instance.sourceGatekeeperId === undefined) return;
  if (instance.placementDecision.type !== "installation") {
    throw new Error("Standing cleanup requires an Installation Decision lineage.");
  }
  const decision = storage.installationDecisions.get(instance.placementDecision.decisionId);
  if (!decision) throw new Error("Installation Decision disappeared before cleanup.");
  const effectId = issueAuthorityId<"authorityEffect">();
  const effectSequence = appendAuthorityEvent(storage, {
    type: "authorityEffectCreated",
    subjectId: effectId,
    operationId,
  });
  storage.workspaceAuthorityEffects.put({
    id: effectId,
    operationId,
    stepKey: `cleanup-provider:${instance.id}`,
    kind: invalidateEndpoint ? "cleanupObsoleteContract" : "cleanupProviderBacking",
    targetId: instance.id,
    lane: `contract-instance:${instance.id}`,
    causalSequence: effectSequence,
    inputDigest: binding.endpointSnapshot!.authoritySnapshotDigest,
    sourceGatekeeperId: instance.sourceGatekeeperId,
    ...(instance.runtimeWorkpieceId !== undefined
      ? {runtimeWorkpieceId: instance.runtimeWorkpieceId}
      : {}),
    ...(invalidateEndpoint && binding.endpointSnapshot
      ? {endpointSnapshot: structuredClone(binding.endpointSnapshot)}
      : {}),
    expectedProvider: structuredClone(instance.providerBacking.provider),
    contractInstance: {id: instance.id, generation: instance.generation},
    expectedCapabilityGeneration: instance.providerBacking.capabilityGeneration,
    deactivationOperationId: `${decision.operationId}:provider-deactivate:${instance.id}`,
    state: "pending",
    attempt: 0,
    nextAttemptAt: 0,
    cleanupResponsibility: true,
  });
}

function standingEffectContext(effect: StandingInstallationEffect): StandingInstallationEffectContext {
  return {
    targetId: effect.targetId,
    decisionId: effect.decisionId,
    command: structuredClone(effect.command),
    principalId: effect.principalId,
    permissionGeneration: effect.permissionGeneration,
    providerDescription: structuredClone(effect.providerDescription),
    planId: effect.planId,
    bindingId: effect.bindingId,
    targetBindingGeneration: effect.targetBindingGeneration,
    phase: effect.phase,
    ...(effect.endpointAcknowledgement
      ? {endpointAcknowledgement: structuredClone(effect.endpointAcknowledgement)}
      : {}),
    cleanupResponsibility: false,
  };
}

function succeedAuthorityEffect(
  storage: AuthorityStorage,
  effect: WorkspaceAuthorityEffect,
): void {
  appendAuthorityEvent(storage, {
    type: "authorityEffectSucceeded",
    subjectId: effect.id,
    operationId: effect.operationId,
  });
  storage.workspaceAuthorityEffects.put({...effect, state: "succeeded",
    claimToken: undefined, claimUntil: undefined, reason: undefined});
}

function backfillLegacyContract<Gadget extends LegacyGadgetAuthorityRecord>(
  storage: AuthorityStorage,
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
  legacy: LegacyContractAuthorityRecord,
  terminal: boolean,
): {instanceId: ContractInstanceId; changed: boolean} {
  const existingId = mapLegacyIdentity(storage, "contractInstance", legacy.id);
  const existing = storage.contractInstances.get(existingId);
  if (existing) {
    if (existing.artifactHash !== legacy.artifactHash ||
        existing.runtimeProfileHash !== legacy.runtimeProfileHash) {
      throw new Error(`Legacy Contract ${legacy.id} changed after it was staged.`);
    }
    const deltas = [...storage.authorityMigrationDeltas.byContract.get(legacy.id)];
    if (deltas.length === 0) return {instanceId: existingId, changed: false};
    discardStagedContract(storage, existing);
  }
  const sourceId = mapLegacyIdentity(storage, "source", legacy.sourceGatekeeperId);
  const approvalId = mapLegacyIdentity(storage, "artifactApproval", legacy.id);
  const decisionId = mapLegacyIdentity(storage, "installationDecision", legacy.id);
  const upstreamAuthority: UpstreamAuthorityReference = {
    sourceId,
    sourceGeneration: 1,
    origin: {type: "legacyGatekeeper", workpieceId: legacy.sourceGatekeeperId},
  };
  const placement = terminal ? undefined : findLegacyPlacement(adapter, legacy.id);
  const consumer: ConsumerReference | undefined = placement
    ? {
        type: "standing",
        consumerId: mapLegacyIdentity(storage, "consumer", placement.gadget.id),
        generation: 1,
      }
    : undefined;
  const requirement: BindingRequirementReference | undefined = placement
    ? {
        type: "environment",
        bindingSetId: mapLegacyIdentity(storage, "bindingSet", placement.gadget.id),
        bindingSetVersion: 1,
        requirementId: mapLegacyIdentity(
          storage,
          "requirement",
          compositeKey(placement.gadget.id, placement.name),
        ),
        requirementVersion: 1,
      }
    : undefined;
  let approvalEpoch = 1;
  while (storage.artifactApprovals.byArtifactEpoch.get(
    compositeKey(legacy.artifactHash, approvalEpoch),
  )) {
    approvalEpoch++;
  }
  storage.artifactApprovals.put({
    id: approvalId,
    artifactHash: legacy.artifactHash,
    approvalEpoch,
    evidence: "legacyUnknown",
    decision: "approved",
    decidedBy: legacy.approvedBy,
    decisionSequence: 0,
    lifecycle: "active",
    revision: 1,
  });
  storage.installationDecisions.put({
    id: decisionId,
    operationId: `legacy-contract:${legacy.id}`,
    proposalDigest: digestText(`legacy-contract:${legacy.id}`),
    decision: "approved",
    decidedBy: legacy.approvedBy,
    decisionSequence: 0,
    ...(consumer ? {consumer} : {}),
    ...(requirement ? {requirement} : {}),
    ...(placement ? {intendedBindingName: placement.name, expectedBindingGeneration: 0} : {}),
  });
  const instance: ContractInstanceRecord = {
    id: existingId,
    legacyWorkpieceId: legacy.id,
    artifactApprovalId: approvalId,
    artifactHash: legacy.artifactHash,
    runtimeProfileHash: legacy.runtimeProfileHash,
    upstreamAuthority,
    placementDecision: {type: "installation", decisionId},
    ...(consumer ? {intendedConsumer: consumer} : {}),
    ...(requirement ? {intendedRequirement: requirement} : {}),
    sharedState: legacy.sharedStateKey
      ? {type: "shared", key: legacy.sharedStateKey}
      : {type: "isolated"},
    lifecycle: terminal ? "retracted" : placement ? "ready" : "prepared",
    generation: 1,
    revision: 1,
    createdSequence: 0,
  };
  storage.contractInstances.put(instance);
  if (terminal) {
    storage.authorityTombstones.put({
      id: mapLegacyIdentity(storage, "authorityTombstone", legacy.id),
      subject: {type: "contractInstance", id: instance.id},
      terminalReason: "legacy-contract-retracted",
      terminalSequence: 0,
      cleanup: "complete",
    });
  }
  if (placement && consumer && requirement) {
    const bindingId = mapLegacyIdentity(
      storage,
      "binding",
      compositeKey(placement.gadget.id, placement.name),
    );
    const resolutionId = mapLegacyIdentity(
      storage,
      "bindingResolution",
      compositeKey(placement.gadget.id, placement.name),
    );
    storage.bindingResolutions.put({
      id: resolutionId,
      consumer,
      requirement,
      upstreamAuthority,
      verification: {type: "legacyUnknown"},
      artifactApprovalId: approvalId,
      artifactApprovalEpoch: approvalEpoch,
      placementDecision: {type: "installation", decisionId},
      contractInstanceId: instance.id,
      bindingId,
      sharedState: instance.sharedState,
      expectedBindingGeneration: 0,
      evaluatorPolicyHash: "legacy:unknown",
      createdSequence: 0,
    });
    storage.bindings.put({
      id: bindingId,
      consumer,
      name: placement.name,
      requirement,
      contractInstanceId: instance.id,
      resolutionId,
      status: "active",
      generation: 1,
      revision: 1,
      installedSequence: 0,
    });
  }
  storage.authorityMigrationDeltas.byContract.delete(legacy.id);
  return {instanceId: instance.id, changed: true};
}

function validateBackfill<Gadget extends LegacyGadgetAuthorityRecord>(
  storage: AuthorityStorage,
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
): void {
  if ([...storage.authorityMigrationDeltas.list()].length !== 0) {
    throw new Error("Legacy migration deltas must be replayed before cutover.");
  }
  for (const legacy of adapter.listContracts()) {
    const instance = storage.contractInstances.byLegacyWorkpieceId.get(legacy.id);
    if (!instance) throw new Error(`Legacy Contract ${legacy.id} has not been backfilled.`);
    const placement = findLegacyPlacement(adapter, legacy.id);
    if (!placement) continue;
    const consumerId = mapLegacyIdentity(storage, "consumer", placement.gadget.id);
    const binding = storage.bindings.currentByConsumerName.get(
      compositeKey(consumerId, placement.name),
    );
    if (!binding || binding.contractInstanceId !== instance.id) {
      throw new Error(`Legacy Binding ${placement.gadget.id}.${placement.name} is not canonical.`);
    }
  }
  for (const legacy of adapter.listContractTombstones()) {
    const instance = storage.contractInstances.byLegacyWorkpieceId.get(legacy.id);
    if (!instance || instance.lifecycle !== "retracted") {
      throw new Error(`Legacy Contract tombstone ${legacy.id} has not been backfilled.`);
    }
    const tombstone = storage.authorityTombstones.bySubject.get(
      compositeKey("contractInstance", instance.id),
    );
    if (!tombstone) {
      throw new Error(`Legacy Contract tombstone ${legacy.id} has no canonical lineage.`);
    }
  }
}

function requireGadget<Gadget extends LegacyGadgetAuthorityRecord>(
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
  id: WorkpieceId,
): Gadget {
  const gadget = adapter.getGadget(id);
  if (!gadget) throw new Error(`No such Gadget: ${id}`);
  return gadget;
}

function visibleBindings(
  gadget: LegacyGadgetAuthorityRecord,
  forChatId?: number,
): [string, LegacyGadgetBindingRecord][] {
  return Object.entries(gadget.bindings).filter(
    ([, edge]) => !edge.pending || edge.pending.chatId === forChatId,
  );
}

function requireAuthorityCommandContext(
  storage: AuthorityStorage,
  session: AuthoritySessionBinding,
  command: AuthorityCommandEnvelope,
  requestDigest: string,
): Readonly<{operation: AuthorityOperationRecord; liveGeneration: number}> {
  const state = requireActiveAuthority(storage);
  const authorityEpoch = state.authorityEpoch ?? 1;
  const liveGeneration = session.permissionKind === "owner"
    ? state.ownerGeneration ?? 1
    : (() => {
        const grant = storage.authorityManagerGrants.get(session.principalId);
        return grant?.state === "active" ? grant.generation : undefined;
      })();
  if (session.authorityEpoch !== authorityEpoch ||
      command.expectedAuthorityEpoch !== authorityEpoch ||
      liveGeneration === undefined || session.permissionGeneration !== liveGeneration ||
      command.expectedPermissionGeneration !== liveGeneration) {
    throw new Error("Authority session is stale or revoked.");
  }
  if (command.requestDigest !== requestDigest) throw new Error("Authority command digest mismatch.");
  const operation = storage.authorityOperations.get(command.operationId);
  if (!operation || operation.actor !== session.principalId) {
    throw new Error("Authority Operation is unavailable.");
  }
  return {operation, liveGeneration};
}

/** Creates the sole in-process Workspace Authority module over the existing Workspace storage. */
export function createWorkspaceAuthorityModule<
  Gadget extends LegacyGadgetAuthorityRecord = LegacyGadgetAuthorityRecord,
>(
  durableStorage: DurableObjectStorage,
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
): WorkspaceAuthorityModule {
  const storage = makeAuthorityStorage(durableStorage);
  const consumerFacts = createConsumerEnvironmentAuthority(durableStorage, () => {
    throw new Error("Task fact reads never resolve a capability environment.");
  });
  const issuedLegacyManagerSourceAccess = new WeakSet<object>();

  const authority: WorkspaceAuthority = {
    openSession(principalId, isOwner) {
      return storage.transaction(() => {
        const state = requireActiveAuthority(storage);
        const authorityEpoch = state.authorityEpoch ?? 1;
        if (isOwner) {
          return {
            principalId,
            permissionKind: <const>"owner",
            permissionGeneration: state.ownerGeneration ?? 1,
            authorityEpoch,
          };
        }
        const grant = storage.authorityManagerGrants.get(principalId);
        if (!grant || grant.state !== "active") return undefined;
        return {
          principalId,
          permissionKind: <const>"manager",
          permissionGeneration: grant.generation,
          authorityEpoch,
        };
      });
    },
    beginOperation(session, idempotencyKey, requestDigest) {
      return storage.transaction(() => {
        const state = requireActiveAuthority(storage);
        const liveGeneration = session.permissionKind === "owner"
          ? state.ownerGeneration ?? 1
          : storage.authorityManagerGrants.get(session.principalId)?.generation;
        if (session.authorityEpoch !== (state.authorityEpoch ?? 1) ||
            session.permissionGeneration !== liveGeneration || !idempotencyKey ||
            !CONTENT_HASH.test(requestDigest)) {
          throw new Error("Authority session or operation request is invalid.");
        }
        const existing = storage.authorityOperations.byActorKey.get(
          compositeKey(session.principalId, idempotencyKey),
        );
        if (existing) {
          if (existing.requestDigest !== requestDigest) throw new Error("Authority idempotency conflict.");
          return existing;
        }
        const operation: AuthorityOperationRecord = {
          id: issueAuthorityId<"authorityOperation">(),
          actor: session.principalId,
          idempotencyKey,
          requestDigest,
          state: "begun",
        };
        storage.authorityOperations.put(operation);
        return operation;
      });
    },
    getOperation(session, operationId) {
      return storage.transaction(() => {
        const state = requireActiveAuthority(storage);
        const liveGeneration = session.permissionKind === "owner"
          ? state.ownerGeneration ?? 1
          : storage.authorityManagerGrants.get(session.principalId)?.generation;
        if (session.authorityEpoch !== (state.authorityEpoch ?? 1) ||
            session.permissionGeneration !== liveGeneration) {
          throw new Error("Authority session is stale or revoked.");
        }
        const operation = storage.authorityOperations.get(operationId);
        return operation?.actor === session.principalId ? operation : undefined;
      });
    },
    hasReviewEvidence(session, bundleHash, comparisonHash) {
      return storage.transaction(() => {
        const state = requireActiveAuthority(storage);
        const liveGeneration = session.permissionKind === "owner"
          ? state.ownerGeneration ?? 1
          : storage.authorityManagerGrants.get(session.principalId)?.generation;
        if (session.authorityEpoch !== (state.authorityEpoch ?? 1) ||
            session.permissionGeneration !== liveGeneration) {
          throw new Error("Authority session is stale or revoked.");
        }
        return [...storage.artifactProposals.list()].some(proposal =>
          proposal.reviewBundleHash === bundleHash &&
          proposal.reviewComparisonHash === comparisonHash);
      });
    },
    recordStandingInstallationDecision(session, command, requestDigest, record) {
      return storage.transaction(() => {
        const {liveGeneration} = requireAuthorityCommandContext(
          storage,
          session,
          command,
          requestDigest,
        );
        const existing = storage.installationDecisions.byOperation.get(command.operationId);
        if (existing) {
          const expected = {
            ...structuredClone(record),
            decidedBy: session.principalId,
            permissionGeneration: liveGeneration,
          };
          const {
            id: _id,
            operationId: _operationId,
            decisionSequence: _decisionSequence,
            ...actual
          } = existing;
          if (!sameAuthorityValue(actual, expected)) {
            throw new Error("Authority Installation Operation was reused for another decision.");
          }
          return existing;
        }
        const approval = requireActiveApproval(
          storage,
          command.artifactApprovalId as ArtifactApprovalId,
        );
        if (approval.approvalEpoch !== command.artifactApprovalEpoch ||
            approval.evidence !== "complete" || approval.proposalId !== command.proposalId ||
            approval.policyHash !== command.evaluatorPolicyHash) {
          throw new Error("Standing installation differs from its active Artifact Approval.");
        }
        if (record.decision !== "approved" || !record.consumer || !record.requirement ||
            record.intendedBindingName !== command.bindingName ||
            record.expectedBindingGeneration !== command.expectedBindingGeneration) {
          throw new Error("Standing installation decision is incomplete or mismatched.");
        }
        const id = issueAuthorityId<"installationDecision">();
        const sequence = appendAuthorityEvent(storage, {
          type: "installationDecisionRecorded",
          subjectId: id,
          operationId: command.operationId,
        });
        const decision: InstallationDecisionRecord = {
          ...structuredClone(record),
          id,
          operationId: command.operationId,
          decidedBy: session.principalId,
          permissionGeneration: liveGeneration,
          decisionSequence: sequence,
        };
        storage.installationDecisions.put(decision);
        return decision;
      });
    },
    acceptStandingInstallation(input) {
      return storage.transaction(() => {
        const decision = authority.recordStandingInstallationDecision(
          input.session,
          input.command,
          input.requestDigest,
          input.decision,
        );
        const prepared = authority.execute({
          type: "prepareContractInstance",
          operationId: `${input.command.operationId}:instance`,
          record: {
            ...structuredClone(input.instance),
            placementDecision: {type: "installation", decisionId: decision.id},
          },
        });
        if (prepared.type !== "contractInstancePrepared") {
          throw new Error("Standing installation did not prepare its Contract Instance.");
        }
        const effect = authority.startStandingInstallationEffect({
          command: input.command,
          requestDigest: input.requestDigest,
          decision,
          contractInstanceId: prepared.id,
          providerDescription: input.providerDescription,
        });
        return {decision, contractInstanceId: prepared.id, effect};
      });
    },
    decideArtifactProposal(session, command, requestDigest) {
      return storage.transaction(() => {
        const state = requireActiveAuthority(storage);
        const authorityEpoch = state.authorityEpoch ?? 1;
        const liveGeneration = session.permissionKind === "owner"
          ? state.ownerGeneration ?? 1
          : (() => {
              const grant = storage.authorityManagerGrants.get(session.principalId);
              return grant?.state === "active" ? grant.generation : undefined;
            })();
        if (session.authorityEpoch !== authorityEpoch ||
            command.expectedAuthorityEpoch !== authorityEpoch ||
            liveGeneration === undefined || session.permissionGeneration !== liveGeneration ||
            command.expectedPermissionGeneration !== liveGeneration) {
          throw new Error("Authority session is stale or revoked.");
        }
        if (command.requestDigest !== requestDigest) {
          throw new Error("Authority command digest mismatch.");
        }
        const operation = storage.authorityOperations.get(command.operationId);
        if (!operation || operation.actor !== session.principalId) {
          throw new Error("Authority Operation is unavailable.");
        }
        const receiptKey = compositeKey(session.principalId, command.operationId, command.stepKey);
        const receipt = storage.authorityCommandReceipts.get(receiptKey);
        if (receipt) {
          if (receipt.requestDigest !== requestDigest) throw new Error("Authority idempotency conflict.");
          return {
            type: <const>"artifactApprovalRecorded",
            id: receipt.artifactApprovalId,
            approvalEpoch: receipt.artifactApprovalEpoch,
            sequence: receipt.sequence,
          };
        }
        if (command.evidence.proposalId.length === 0) {
          throw new TypeError("Artifact Proposal ID is required.");
        }
        const proposal = storage.artifactProposals.get(command.evidence.proposalId as ArtifactProposalId);
        if (!proposal || proposal.revision !== command.expectedProposalRevision || proposal.state !== "pending") {
          throw new Error("Artifact Proposal is stale or not pending.");
        }
        const record: LiveArtifactApprovalInput = {
          ...structuredClone(command.evidence),
          proposalId: command.evidence.proposalId as ArtifactProposalId,
          baseline: command.evidence.baseline.type === "none"
            ? {type: "none"}
            : {
                type: "bundle",
                bundleHash: command.evidence.baseline.bundleHash,
                artifactApprovalId: command.evidence.baseline.artifactApprovalId as ArtifactApprovalId,
              },
          evidence: "complete",
          decision: command.decision,
          decidedBy: session.principalId,
          permissionGeneration: liveGeneration,
          lifecycle: command.decision === "approved" ? "active" : "revoked",
        };
        const validatedProposal = validateArtifactApprovalEvidence(storage, record);
        let approvalEpoch = 1;
        while (storage.artifactApprovals.byArtifactEpoch.get(
          compositeKey(record.artifactHash, approvalEpoch),
        )) approvalEpoch++;
        const id = issueAuthorityId<"artifactApproval">();
        const sequence = appendAuthorityEvent(storage, {
          type: "artifactApprovalRecorded",
          subjectId: id,
          operationId: command.operationId,
        });
        storage.artifactApprovals.put({
          ...record,
          id,
          approvalEpoch,
          decisionSequence: sequence,
          revision: 1,
        });
        storage.artifactProposals.put({
          ...validatedProposal,
          state: command.decision === "approved" ? "accepted" : "rejected",
          revision: validatedProposal.revision + 1,
        });
        storage.authorityCommandReceipts.put({
          key: receiptKey,
          requestDigest,
          artifactApprovalId: id,
          artifactApprovalEpoch: approvalEpoch,
          decision: command.decision,
          sequence,
        });
        storage.authorityOperations.put({
          ...operation,
          state: "completed",
          lastCompletedStep: command.stepKey,
          result: {
            type: "artifactProposalDecided",
            artifactApprovalId: id,
            artifactApprovalEpoch: approvalEpoch,
            decision: command.decision,
          },
        });
        return {type: "artifactApprovalRecorded", id, approvalEpoch, sequence};
      });
    },
    requestAgentTaskCancellation(session, command, requestDigest) {
      return storage.transaction(() => {
        const {operation} = requireAuthorityCommandContext(
          storage,
          session,
          command,
          requestDigest,
        );
        const receiptKey = compositeKey(session.principalId, command.operationId, command.stepKey);
        const receipt = storage.agentTaskCancellationReceipts.get(receiptKey);
        if (receipt) {
          if (receipt.requestDigest !== requestDigest) {
            throw new Error("Authority idempotency conflict.");
          }
          const cancellation = storage.agentTaskCancellations.get(receipt.taskId);
          return {
            type: <const>"agentTaskCancellationRequested",
            taskId: receipt.taskId,
            cancellationGeneration: receipt.generation,
            state: cancellation?.state ?? <const>"requested",
          };
        }
        const taskId = command.taskId as AgentTaskId;
        const task = storage.agentTasks.get(taskId);
        const environment = task && storage.taskEnvironments.byTaskGeneration.get(
          compositeKey(task.id, task.environmentGeneration),
        );
        if (!task || !environment || task.generation !== command.expectedTaskGeneration ||
            environment.generation !== command.expectedEnvironmentGeneration ||
            environment.ratchetVersion !== command.expectedRatchetVersion ||
            ["completed", "failed", "cancelled", "expired"].includes(task.lifecycle)) {
          throw new Error("Agent Task cancellation target is unavailable or stale.");
        }
        const previous = storage.agentTaskCancellations.get(taskId);
        const generation = (previous?.generation ?? 0) + 1;
        storage.agentTaskCancellations.put({
          taskId,
          generation,
          expectedTaskGeneration: task.generation,
          expectedEnvironmentGeneration: environment.generation,
          expectedRatchetVersion: environment.ratchetVersion,
          requestedBy: session.principalId,
          requestedAt: Date.now(),
          state: "requested",
        });
        appendAuthorityEvent(storage, {
          type: "agentTaskCancellationRequested",
          subjectId: taskId,
          operationId: command.operationId,
          beforeGeneration: previous?.generation,
          afterGeneration: generation,
        });
        const result = {
          type: <const>"agentTaskCancellationRequested",
          taskId,
          cancellationGeneration: generation,
          state: <const>"requested",
        };
        storage.agentTaskCancellationReceipts.put({
          key: receiptKey,
          requestDigest,
          taskId,
          generation,
        });
        storage.authorityOperations.put({
          ...operation,
          state: "completed",
          lastCompletedStep: command.stepKey,
          result,
        });
        return result;
      });
    },
    listAgentTaskAuthorityViews(session) {
      return storage.transaction(() => {
        const live = authority.openSession(
          session.principalId,
          session.permissionKind === "owner",
        );
        if (!live || live.authorityEpoch !== session.authorityEpoch ||
            live.permissionGeneration !== session.permissionGeneration ||
            live.permissionKind !== session.permissionKind) {
          throw new Error("Authority session is stale or revoked.");
        }
        return Array.from(storage.agentTasks.list()).map(task => {
          const environment = storage.taskEnvironments.byTaskGeneration.get(
            compositeKey(task.id, task.environmentGeneration),
          );
          const approval = storage.taskTemplateApprovals.get(task.templateApprovalId);
          const template = approval && storage.taskTemplateVersions.get(
            compositeKey(approval.taskTemplateId, approval.taskTemplateVersion),
          );
          const dispatch = storage.taskDispatchDecisions.get(task.dispatchDecisionId);
          if (!environment || !approval || !template || !dispatch) {
            throw new Error(`Agent Task ${task.id} governance lineage is incomplete.`);
          }
          const blocks: Array<AgentTaskAuthorityView["blocks"][number]> = [];
          if (environment.state !== "ready") {
            blocks.push({type: "missingAcknowledgement", reference: environment.id});
          }
          for (const placement of environment.bindings) {
            const binding = storage.bindings.get(placement.bindingId);
            if (!binding || binding.status !== "active") {
              blocks.push({type: "staleParallelWork", reference: placement.bindingId});
            }
          }
          const cancellation = storage.agentTaskCancellations.get(task.id);
          const operational = storage.agentTaskOperationalState.get(task.id);
          const profile = storage.agentServiceProfiles.get(task.agentServiceProfileId);
          if (!profile || profile.generation !== task.agentServiceProfileGeneration) {
            throw new Error(`Agent Task ${task.id} Agent Service lineage is incomplete.`);
          }
          if (cancellation?.state === "requested") {
            blocks.push({type: "missingAcknowledgement",
              reference: `cancellation:${cancellation.generation}`});
          }
          for (const reference of operational?.protectedResultRefs ?? []) {
            blocks.push({type: "protectedResult", reference});
          }
          for (const reference of operational?.missingAcknowledgementRefs ?? []) {
            blocks.push({type: "missingAcknowledgement", reference});
          }
          for (const reference of operational?.staleParallelWorkRefs ?? []) {
            blocks.push({type: "staleParallelWork", reference});
          }
          const authorityEvents = Array.from(storage.workspaceAuthorityEvents.list())
            .filter(event => event.subjectId === task.id)
            .map(event => `authority-event:${event.sequence}`);
          return {
            taskId: task.id,
            taskGeneration: task.generation,
            lifecycle: task.lifecycle,
            principal: structuredClone(task.correlation.principal),
            agentServiceProfile: {
              id: task.agentServiceProfileId,
              generation: task.agentServiceProfileGeneration,
            },
            agentServiceWorkload: {
              id: profile.workloadId,
              generation: profile.workloadGeneration,
            },
            template: {
              id: template.taskTemplateId,
              version: template.version,
              approvalId: approval.id,
              approvalLifecycle: approval.lifecycle,
              ...(template.supersedesVersion === undefined
                ? {}
                : {supersedesVersion: template.supersedesVersion}),
              ceilingDigest: template.ceilingDigest,
              artifactApprovals: structuredClone(approval.artifactApprovals),
            },
            lease: {
              generation: task.leaseGeneration,
              expiresAt: task.leaseExpiresAt,
              absoluteExpiresAt: task.absoluteExpiresAt,
            },
            environment: {
              generation: environment.generation,
              ratchetVersion: environment.ratchetVersion,
              state: environment.state,
              originalAuthorityDigest: dispatch.effectiveAuthorityEnvelopeHash,
              currentAuthorityDigest: environment.effectiveAuthorityDigest,
              bindings: environment.bindings.map(binding => ({
                name: binding.name,
                bindingId: binding.bindingId,
                contractInstanceId: binding.contractInstanceId,
              })),
            },
            ...(cancellation ? {cancellation: {
              generation: cancellation.generation,
              state: cancellation.state,
            }} : {}),
            blocks,
            evidence: {
              authorityEvents,
              sourceActivities: structuredClone(operational?.sourceActivityRefs ?? []),
              agentActivities: structuredClone(operational?.agentActivityRefs ?? []),
            },
          } satisfies AgentTaskAuthorityView;
        });
      });
    },
    listTaskTemplateAuthorityViews(session) {
      return storage.transaction(() => {
        const live = authority.openSession(
          session.principalId,
          session.permissionKind === "owner",
        );
        if (!live || live.authorityEpoch !== session.authorityEpoch ||
            live.permissionGeneration !== session.permissionGeneration ||
            live.permissionKind !== session.permissionKind) {
          throw new Error("Authority session is stale or revoked.");
        }
        const approvals = Array.from(storage.taskTemplateApprovals.list());
        return approvals.map(approval => {
          const template = storage.taskTemplateVersions.get(
            compositeKey(approval.taskTemplateId, approval.taskTemplateVersion),
          );
          if (!template || template.ceilingDigest !== approval.ceilingDigest) {
            throw new Error(`Task Template Approval ${approval.id} lineage is incomplete.`);
          }
          const consequences = approval.lifecycle === "revoked" ? {
            newDispatchConsequence: "Refused immediately.",
            activeTaskConsequence: "Invalidate environments and result gates; cancel without resume.",
          } : approval.lifecycle === "deprecated" ? {
            newDispatchConsequence: "Refused from deprecation.",
            activeTaskConsequence:
              "May continue only within the existing absolute deadline; no new child may cite it.",
          } : {
            newDispatchConsequence: "Eligible while every pinned fact remains active.",
            activeTaskConsequence: "Remains pinned to this exact version and approval epoch.",
          };
          return {
            id: template.taskTemplateId,
            version: template.version,
            approvalId: approval.id,
            approvalLifecycle: approval.lifecycle,
            ...(template.supersedesVersion === undefined
              ? {}
              : {supersedesVersion: template.supersedesVersion}),
            ceilingDigest: template.ceilingDigest,
            artifactApprovals: structuredClone(approval.artifactApprovals),
            requirements: template.requirements.map(requirement => ({
              requirementId: requirement.requirementId,
              name: requirement.name,
              required: requirement.required,
              authorityEnvelopeHash: requirement.maximumEffectiveAuthorityEnvelopeHash,
              artifactApprovalId: requirement.artifactApprovalId,
              artifactApprovalEpoch: requirement.artifactApprovalEpoch,
            })),
            maximumTaskDurationMs: template.maximumTaskDurationMs,
            ...consequences,
          } satisfies TaskTemplateAuthorityView;
        });
      });
    },
    setManagerGrant(ownerSession, command, requestDigest) {
      return storage.transaction(() => {
        const state = requireActiveAuthority(storage);
        if (ownerSession.permissionKind !== "owner" ||
            ownerSession.authorityEpoch !== (state.authorityEpoch ?? 1) ||
            ownerSession.permissionGeneration !== (state.ownerGeneration ?? 1) ||
            command.expectedAuthorityEpoch !== (state.authorityEpoch ?? 1) ||
            command.expectedPermissionGeneration !== (state.ownerGeneration ?? 1) ||
            command.requestDigest !== requestDigest) {
          throw new Error("Authority owner session is stale or revoked.");
        }
        const operation = storage.authorityOperations.get(command.operationId);
        if (!operation || operation.actor !== ownerSession.principalId) {
          throw new Error("Authority Operation is unavailable.");
        }
        const receiptKey = compositeKey(ownerSession.principalId, command.operationId, command.stepKey);
        const receipt = storage.authorityOwnerCommandReceipts.get(receiptKey);
        if (receipt) {
          if (receipt.requestDigest !== requestDigest) throw new Error("Authority idempotency conflict.");
          return {principalId: command.principalId, generation: receipt.generation, state: receipt.state};
        }
        if (!command.principalId) throw new TypeError("Authority manager principal is required.");
        const current = storage.authorityManagerGrants.get(command.principalId);
        const next: AuthorityManagerGrant = {
          principalId: command.principalId,
          generation: (current?.generation ?? 0) + 1,
          state: command.enabled ? "active" : "revoked",
        };
        storage.authorityManagerGrants.put(next);
        appendAuthorityEvent(storage, {
          type: "authorityManagerGrantChanged",
          subjectId: command.principalId,
          operationId: command.operationId,
        });
        storage.authorityOwnerCommandReceipts.put({
          key: receiptKey,
          requestDigest,
          generation: next.generation,
          state: next.state,
        });
        storage.authorityOperations.put({
          ...operation,
          state: "completed",
          lastCompletedStep: command.stepKey,
          result: {
            type: "managerGrantChanged",
            generation: next.generation,
            state: next.state,
          },
        });
        return next;
      });
    },
    execute(command) {
      switch (command.type) {
        case "initialize":
          return storage.transaction(() => {
            const current = storage.workspaceAuthorityState.get();
            if (current) {
              return {type: "initialized", changed: false, revision: current.revision};
            }
            const initial: WorkspaceAuthorityState = {
              state: "legacy",
              revision: 1,
              nextEventSequence: 2,
              authorityEpoch: 1,
              ownerGeneration: 1,
            };
            storage.workspaceAuthorityState.put(initial);
            storage.workspaceAuthorityEvents.put({
              sequence: 1,
              type: "authorityModuleInitialized",
              revision: initial.revision,
            });
            return {type: "initialized", changed: true, revision: initial.revision};
          });
        case "beginBackfill":
          return storage.transaction(() => {
            const current = requireAuthorityState(storage);
            if (current.state === "backfilling" && current.migrationId === command.migrationId) {
              return {type: "backfillStarted", changed: false, revision: current.revision};
            }
            if (current.state !== "legacy") {
              throw new Error(`Cannot begin backfill while authority is ${current.state}.`);
            }
            const next = {
              ...current,
              state: <const>"backfilling",
              revision: current.revision + 1,
              migrationId: command.migrationId,
            };
            storage.workspaceAuthorityState.put(next);
            return {type: "backfillStarted", changed: true, revision: next.revision};
          });
        case "backfillLegacyContract":
          return storage.transaction(() => {
            if (requireAuthorityState(storage).state !== "backfilling") {
              throw new Error("Legacy backfill is not active.");
            }
            const live = adapter.getContract(command.legacyContractId);
            const legacy = live ?? adapter.getContractTombstone(command.legacyContractId);
            if (!legacy) throw new Error(`No such legacy Contract: ${command.legacyContractId}`);
            const result = backfillLegacyContract(storage, adapter, legacy, !live);
            return {type: "legacyContractBackfilled", ...result};
          });
        case "markReadyToCutover":
          return storage.transaction(() => {
            const current = requireAuthorityState(storage);
            if (current.state !== "backfilling") {
              throw new Error(`Cannot prepare cutover while authority is ${current.state}.`);
            }
            validateBackfill(storage, adapter);
            const snapshot = migrationSnapshot(storage);
            if (snapshot.digest !== command.expectedDigest) {
              throw new Error("Cutover candidate digest changed.");
            }
            const next = {
              ...current,
              state: <const>"readyToCutover",
              revision: current.revision + 1,
              cutoverDigest: snapshot.digest,
            };
            storage.workspaceAuthorityState.put(next);
            return {type: "readyToCutover", digest: snapshot.digest, revision: next.revision};
          });
        case "cutover":
          return storage.transaction(() => {
            const current = requireAuthorityState(storage);
            if (current.state !== "readyToCutover") {
              throw new Error(`Cannot cut over while authority is ${current.state}.`);
            }
            validateBackfill(storage, adapter);
            const snapshot = migrationSnapshot(storage);
            if (snapshot.digest !== command.expectedDigest ||
                current.cutoverDigest !== command.expectedDigest) {
              throw new Error("Cutover candidate digest changed.");
            }
            const sequence = appendAuthorityEvent(storage, {
              type: "migrationBaseline",
              operationId: current.migrationId,
              migrationBaseline: {...snapshot, unknownHistory: true},
            });
            const afterEvent = requireAuthorityState(storage);
            const next = {...afterEvent, state: <const>"active"};
            storage.workspaceAuthorityState.put(next);
            return {
              type: "cutoverCompleted",
              digest: snapshot.digest,
              sequence,
              revision: next.revision,
            };
          });
        case "recordArtifactProposal":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            validateArtifactProposal(command.record);
            const id = issueAuthorityId<"artifactProposal">();
            const sequence = appendAuthorityEvent(storage, {
              type: "artifactProposalRecorded",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.artifactProposals.put({
              ...structuredClone(command.record),
              id,
              state: "pending",
              revision: 1,
            });
            return {type: "artifactProposalRecorded", id, sequence};
          });
        case "recordInstallationDecision":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            if (command.record.decision === "approved" &&
                (!command.record.consumer || !command.record.requirement ||
                 !command.record.intendedBindingName ||
                 command.record.expectedBindingGeneration === undefined)) {
              throw new Error("Approved Installation Decisions require an exact placement.");
            }
            const existing = storage.installationDecisions.byOperation.get(command.operationId);
            if (existing) {
              const {id: _id, operationId: _operationId,
                decisionSequence: _decisionSequence, ...existingRecord} = existing;
              if (!sameAuthorityValue(existingRecord, command.record)) {
                throw new Error("Installation Decision Operation was reused for another record.");
              }
              return {type: <const>"installationDecisionRecorded", id: existing.id,
                sequence: existing.decisionSequence};
            }
            const id = issueAuthorityId<"installationDecision">();
            const sequence = appendAuthorityEvent(storage, {
              type: "installationDecisionRecorded",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.installationDecisions.put({
              ...structuredClone(command.record),
              id,
              operationId: command.operationId,
              decisionSequence: sequence,
            });
            return {type: "installationDecisionRecorded", id, sequence};
          });
        case "recordTaskDispatchDecision":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const replay = storage.taskDispatchDecisions.byOperation.get(command.operationId);
            if (replay) {
              const {id: _id, decisionSequence: _sequence, ...record} = replay;
              if (!sameAuthorityValue(record, {...command.record, operationId: command.operationId})) {
                throw new Error("Task Dispatch Operation was reused for another decision.");
              }
              return {type: <const>"taskDispatchDecisionRecorded", id: replay.id,
                sequence: replay.decisionSequence};
            }
            if (command.record.consumer.type !== "agentTask") {
              throw new Error("Task Dispatch Decision requires an Agent Task Consumer.");
            }
            if (command.record.consumer.taskId !== command.record.taskId ||
                command.record.consumer.taskGeneration !== command.record.taskGeneration) {
              throw new Error("Task Dispatch Decision Consumer differs from its task lineage.");
            }
            if (command.record.requirements.length === 0 ||
                command.record.requirements.some(requirement =>
                  requirement.type !== "taskTemplate" ||
                  requirement.taskTemplateId !== command.record.taskTemplateId ||
                  requirement.taskTemplateVersion !== command.record.taskTemplateVersion) ||
                command.record.eligibilityEvidence.length !== command.record.requirements.length ||
                command.record.requirements.some(requirement =>
                  !command.record.eligibilityEvidence.some(evidence =>
                    evidence.requirementId === requirement.requirementId &&
                    evidence.providerCapabilityGeneration > 0 &&
                    evidence.authorityDebtRevision > 0 && evidence.egress.length === 0))) {
              throw new Error("Task Dispatch Decision requirements differ from its Task Template.");
            }
            if (command.record.decision === "approved" &&
                command.record.absoluteExpiry <= Date.now()) {
              throw new Error("Approved Task Dispatch Decision is already expired.");
            }
            const id = issueAuthorityId<"taskDispatchDecision">();
            const sequence = appendAuthorityEvent(storage, {
              type: "taskDispatchDecisionRecorded",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.taskDispatchDecisions.put({
              ...structuredClone(command.record),
              id,
              operationId: command.operationId,
              decisionSequence: sequence,
            });
            return {type: "taskDispatchDecisionRecorded", id, sequence};
          });
        case "recordAgentServiceProfile":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const canonical = consumerFacts.getAgentServiceEligibility(command.record.id);
            if (!canonical || canonical.workloadId !== command.record.workloadId ||
                canonical.workloadGeneration !== command.record.workloadGeneration ||
                !sameAuthorityValue(canonical.workloadConsumer, command.record.workloadConsumer) ||
                canonical.workloadRegistrationId !== command.record.workloadRegistrationId ||
                canonical.workloadRegistrationGeneration !==
                  command.record.workloadRegistrationGeneration ||
                canonical.role !== command.record.role) {
              throw new Error("Agent Service profile differs from its canonical Workload Registration.");
            }
            const current = storage.agentServiceProfiles.get(command.record.id);
            if (current && command.record.generation < current.generation) {
              throw new Error("Agent Service profile generation is stale.");
            }
            if (current && command.record.generation === current.generation &&
                !sameAuthorityValue(current, command.record)) {
              throw new Error("Agent Service profile generation cannot change its authority tuple.");
            }
            if (command.record.generation < 1 || command.record.workloadGeneration < 1 ||
                command.record.workloadRegistrationGeneration < 1 ||
                command.record.workloadConsumer.generation < 1 ||
                command.record.role.trim().length === 0) {
              throw new Error("Agent Service profile is incomplete.");
            }
            storage.agentServiceProfiles.put(structuredClone(command.record));
            appendAuthorityEvent(storage, {
              type: "agentServiceProfileChanged",
              subjectId: command.record.id,
              beforeGeneration: current?.generation,
              afterGeneration: command.record.generation,
            });
            return {
              type: <const>"agentServiceProfileRecorded",
              id: command.record.id,
              generation: command.record.generation,
            };
          });
        case "recordWorkspacePrincipal":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const current = storage.workspacePrincipals.get(command.record.id);
            if (command.record.generation < 1 ||
                (current && command.record.generation < current.generation) ||
                (current && command.record.generation === current.generation &&
                 !sameAuthorityValue(current, command.record))) {
              throw new Error("Workspace Principal generation is stale or mutable.");
            }
            storage.workspacePrincipals.put(structuredClone(command.record));
            if (!current || !sameAuthorityValue(current, command.record)) {
              appendAuthorityEvent(storage, {
                type: "workspacePrincipalChanged",
                subjectId: command.record.id,
                beforeGeneration: current?.generation,
                afterGeneration: command.record.generation,
              });
            }
            return {type: <const>"workspacePrincipalRecorded", id: command.record.id,
              generation: command.record.generation};
          });
        case "recordTaskTemplateVersion":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const record: TaskTemplateVersionRecord = {
              ...structuredClone(command.record),
              id: compositeKey(command.record.taskTemplateId, command.record.version),
            };
            if (record.version < 1 || record.maximumTaskDurationMs < 1 ||
                record.maximumTaskDurationMs > 24 * 60 * 60_000 ||
                record.requirements.length === 0) {
              throw new Error("Task Template version is incomplete.");
            }
            const names = record.requirements.map(requirement => requirement.name);
            const requirementIds = record.requirements.map(requirement => requirement.requirementId);
            if (new Set(names).size !== names.length ||
                new Set(requirementIds).size !== requirementIds.length ||
                record.requirements.some(requirement => {
                  try {
                    validateBindingName(requirement.name);
                    requireContentHash(
                      requirement.maximumEffectiveAuthorityEnvelopeHash,
                      "Task authority envelope",
                    );
                    requireContentHash(requirement.evaluatorPolicyHash, "Task evaluator policy");
                    return requirement.artifactApprovalEpoch < 1 ||
                      requirement.standingBinding.bindingGeneration < 1 ||
                      requirement.standingBinding.contractInstanceGeneration < 1;
                  } catch {
                    return true;
                  }
                })) {
              throw new Error("Task Template requirements are invalid or ambiguous.");
            }
            const existing = storage.taskTemplateVersions.get(record.id);
            if (existing && !sameAuthorityValue(existing, record)) {
              throw new Error("Task Template versions are immutable.");
            }
            storage.taskTemplateVersions.put(structuredClone(record));
            if (!existing) appendAuthorityEvent(storage, {
              type: "taskTemplateVersionRecorded",
              subjectId: record.id,
              afterGeneration: record.version,
            });
            return {type: <const>"taskTemplateVersionRecorded", id: record.id};
          });
        case "recordTaskTemplateApproval":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const record: TaskTemplateApprovalRecord = {
              ...structuredClone(command.record),
              id: issueAuthorityId<"taskTemplateApproval">(),
            };
            const version = storage.taskTemplateVersions.get(
              compositeKey(record.taskTemplateId, record.taskTemplateVersion),
            );
            if (!version || version.ceilingDigest !== record.ceilingDigest ||
                record.approvalEpoch < 1 || record.permissionGeneration < 1) {
              throw new Error("Task Template Approval differs from its immutable version.");
            }
            const expectedApprovals = version.requirements.map(requirement => ({
              id: requirement.artifactApprovalId,
              epoch: requirement.artifactApprovalEpoch,
            })).toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
            const citedApprovals = [...record.artifactApprovals]
              .toSorted((left, right) => String(left.id).localeCompare(String(right.id)));
            if (!sameAuthorityValue(expectedApprovals, citedApprovals) ||
                citedApprovals.some(cited => {
                  const approval = storage.artifactApprovals.get(cited.id);
                  return approval?.lifecycle !== "active" ||
                    approval.approvalEpoch !== cited.epoch || approval.decision !== "approved";
                })) {
              throw new Error("Task Template Approval cites stale Artifact Approval evidence.");
            }
            storage.taskTemplateApprovals.put(structuredClone(record));
            appendAuthorityEvent(storage, {
              type: "taskTemplateApprovalRecorded",
              subjectId: record.id,
              afterGeneration: record.approvalEpoch,
            });
            return {type: <const>"taskTemplateApprovalRecorded", id: record.id};
          });
        case "recordAgentTaskOperationalState":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const record = command.record;
            const task = storage.agentTasks.get(record.taskId);
            const environment = task && storage.taskEnvironments.byTaskGeneration.get(
              compositeKey(task.id, task.environmentGeneration),
            );
            if (!task || !environment || task.generation !== record.taskGeneration ||
                environment.generation !== record.environmentGeneration ||
                environment.ratchetVersion !== record.ratchetVersion) {
              throw new Error("Agent Task operational state generations are stale.");
            }
            const previous = storage.agentTaskOperationalState.get(record.taskId);
            if (previous && record.revision < previous.revision) {
              throw new Error("Agent Task operational state revision is stale.");
            }
            if (previous?.revision === record.revision) {
              if (JSON.stringify(previous) !== JSON.stringify(record)) {
                throw new Error("Agent Task operational state replay differs.");
              }
              return {type: <const>"agentTaskOperationalStateRecorded", taskId: record.taskId,
                revision: record.revision};
            }
            storage.agentTaskOperationalState.put(structuredClone(record));
            return {type: <const>"agentTaskOperationalStateRecorded", taskId: record.taskId,
              revision: record.revision};
          });
        case "materializeAgentTaskDispatch":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const input = command.input;
            const replay = storage.taskDispatchDecisions.byOperation.get(input.operationId);
            if (replay) {
              const task = storage.agentTasks.byDispatch.get(replay.id);
              const environment = task
                ? storage.taskEnvironments.byTaskGeneration.get(compositeKey(task.id, 1))
                : undefined;
              if (!task || !environment || task.intentDigest !== input.intentDigest ||
                  task.createdAt !== input.requestedAt ||
                  task.templateApprovalId !== input.taskTemplateApprovalId ||
                  task.agentServiceProfileId !== input.agentServiceProfileId ||
                  task.agentServiceProfileGeneration !== input.expectedAgentServiceProfileGeneration ||
                  replay.agentServiceWorkloadId !== input.agentService.workloadId ||
                  replay.agentServiceWorkloadGeneration !== input.agentService.workloadGeneration ||
                  replay.workloadRegistrationId !== input.agentService.workloadRegistrationId ||
                  replay.workloadRegistrationGeneration !==
                    input.agentService.workloadRegistrationGeneration ||
                  !sameAuthorityValue(task.correlation.principal, input.principal) ||
                  !sameAuthorityValue(task.correlation.applicationScope, input.applicationScope)) {
                throw new Error("Agent Task dispatch operation was reused for another request.");
              }
              return {type: <const>"agentTaskDispatched", taskId: task.id,
                dispatchDecisionId: replay.id, environmentId: environment.id};
            }
            requireContentHash(input.intentDigest, "Task intent digest");
            if (input.applicationScope) {
              throw new Error("The R2 task runtime has no application-scope adapter.");
            }
            const profile = storage.agentServiceProfiles.get(input.agentServiceProfileId);
            const canonicalAgentService = consumerFacts.getAgentServiceEligibility(
              input.agentServiceProfileId,
            );
            if (!profile || profile.lifecycle !== "active" ||
                profile.generation !== input.expectedAgentServiceProfileGeneration ||
                profile.workloadId !== input.agentService.workloadId ||
                profile.workloadGeneration !== input.agentService.workloadGeneration ||
                !sameAuthorityValue(profile.workloadConsumer, input.agentService.workloadConsumer) ||
                profile.workloadRegistrationId !== input.agentService.workloadRegistrationId ||
                profile.workloadRegistrationGeneration !==
                  input.agentService.workloadRegistrationGeneration ||
                !canonicalAgentService ||
                !sameAuthorityValue(canonicalAgentService, {
                  ...input.agentService,
                  role: profile.role,
                })) {
              throw new Error("Agent Service profile is unavailable or stale.");
            }
            const approval = storage.taskTemplateApprovals.get(input.taskTemplateApprovalId);
            if (!approval || approval.lifecycle !== "active") {
              throw new Error("Task Template Approval is unavailable or inactive.");
            }
            const template = storage.taskTemplateVersions.get(
              compositeKey(approval.taskTemplateId, approval.taskTemplateVersion),
            );
            if (!template || template.ceilingDigest !== approval.ceilingDigest ||
                template.runtimeEnforcementProfile !== "r2-task-v1") {
              throw new Error("Task Template version is unavailable or unsupported.");
            }
            const principal = storage.workspacePrincipals.get(input.principal.id);
            if (!principal || principal.lifecycle !== "active" ||
                principal.generation !== input.principal.generation ||
                (template.principalEligibility.type === "named" &&
                 !template.principalEligibility.principalIds.includes(input.principal.id))) {
              throw new Error("Effective Workspace Principal is ineligible for this Task Template.");
            }
            const placed = template.requirements.flatMap(requirement => {
              const binding = storage.bindings.get(requirement.standingBinding.bindingId);
              const instance = binding
                ? storage.contractInstances.get(binding.contractInstanceId)
                : undefined;
              const resolution = binding
                ? storage.bindingResolutions.get(binding.resolutionId)
                : undefined;
              const debt = binding ? storage.authorityDebts.byBinding.get(binding.id) : undefined;
              const artifactApproval = storage.artifactApprovals.get(requirement.artifactApprovalId);
              const eligible = binding?.status === "active" &&
                binding.name === requirement.standingBinding.name &&
                binding.generation === requirement.standingBinding.bindingGeneration &&
                binding.consumer.type === "standing" &&
                binding.consumer.consumerId === profile.workloadConsumer.consumerId &&
                binding.consumer.generation === profile.workloadConsumer.generation &&
                binding.contractInstanceId === requirement.standingBinding.contractInstanceId &&
                instance?.lifecycle === "ready" &&
                instance.generation === requirement.standingBinding.contractInstanceGeneration &&
                instance.providerBacking !== undefined &&
                instance.providerBacking.providerNativeScope.egress.length === 0 &&
                instance.upstreamAuthority.origin.type === "workspaceAccount" &&
                instance.artifactApprovalId === requirement.artifactApprovalId &&
                resolution?.artifactApprovalId === requirement.artifactApprovalId &&
                resolution.artifactApprovalEpoch === requirement.artifactApprovalEpoch &&
                resolution.evaluatorPolicyHash === requirement.evaluatorPolicyHash &&
                resolution.verification.type === "notRequired" &&
                artifactApproval?.lifecycle === "active" &&
                artifactApproval.approvalEpoch === requirement.artifactApprovalEpoch &&
                artifactApproval.evidence === "complete" &&
                artifactApproval.policyHash === requirement.evaluatorPolicyHash &&
                debt?.productionEligibility === "eligible" && debt.lifecycle !== "remediated";
              if (!eligible && requirement.required) {
                throw new Error(`Required Task Binding ${requirement.name} is unavailable or stale.`);
              }
              return eligible && binding && instance && resolution && debt
                ? [{requirement, binding, instance, resolution, debt}]
                : [];
            });
            const taskId = issueAuthorityId<"agentTask">();
            const consumerId = issueAuthorityId<"consumer">();
            const taskConsumer = {
              type: <const>"agentTask",
              consumerId,
              taskId,
              taskGeneration: 1,
            };
            const requirementReferences = placed.map(({requirement}) => ({
              type: <const>"taskTemplate",
              taskTemplateId: template.taskTemplateId,
              taskTemplateVersion: template.version,
              requirementId: requirement.requirementId,
            }));
            const dispatchId = issueAuthorityId<"taskDispatchDecision">();
            const decisionSequence = appendAuthorityEvent(storage, {
              type: "taskDispatchDecisionRecorded",
              subjectId: dispatchId,
              operationId: input.operationId,
            });
            const absoluteExpiresAt = Math.min(
              input.requestedAt + template.maximumTaskDurationMs,
              input.requestedAt + 24 * 60 * 60_000,
            );
            if (input.requestedAt > Date.now() || absoluteExpiresAt <= Date.now()) {
              throw new Error("Agent Task dispatch deadline is invalid or already expired.");
            }
            const effectiveAuthorityDigest = digestText(JSON.stringify(placed.map(({requirement}) => ({
              requirementId: requirement.requirementId,
              envelope: requirement.maximumEffectiveAuthorityEnvelopeHash,
            }))));
            storage.taskDispatchDecisions.put({
              id: dispatchId,
              operationId: input.operationId,
              taskId,
              taskGeneration: 1,
              taskTemplateId: template.taskTemplateId,
              taskTemplateVersion: template.version,
              taskTemplateApprovalId: approval.id,
              consumer: taskConsumer,
              requirements: requirementReferences,
              effectiveAuthorityEnvelopeHash: effectiveAuthorityDigest,
              initiatingPrincipal: structuredClone(input.principal),
              agentServiceWorkloadId: profile.workloadId,
              agentServiceWorkloadGeneration: profile.workloadGeneration,
              agentServiceProfileId: profile.id,
              agentServiceProfileGeneration: profile.generation,
              workloadRegistrationId: profile.workloadRegistrationId,
              workloadRegistrationGeneration: profile.workloadRegistrationGeneration,
              eligibilityEvidence: placed.map(({requirement, instance, resolution, debt}) => ({
                requirementId: requirement.requirementId,
                upstreamAuthority: structuredClone(instance.upstreamAuthority),
                providerCapabilityGeneration: instance.providerBacking!.capabilityGeneration,
                verification: structuredClone(resolution.verification),
                evaluatorPolicyHash: resolution.evaluatorPolicyHash,
                authorityDebtId: debt.id,
                authorityDebtRevision: debt.revision,
                egress: [] as [],
              })),
              absoluteExpiry: absoluteExpiresAt,
              decision: "approved",
              decidedBy: "system:task-template",
              decisionSequence,
            });
            const environmentBindings = placed.map(({requirement, binding, instance}) => {
              const requirementReference = requirementReferences.find(reference =>
                reference.requirementId === requirement.requirementId)!;
              const contractInstanceId = issueAuthorityId<"contractInstance">();
              const bindingId = issueAuthorityId<"binding">();
              const resolutionId = issueAuthorityId<"bindingResolution">();
              const createdSequence = appendAuthorityEvent(storage, {
                type: "contractInstancePrepared",
                subjectId: contractInstanceId,
                operationId: input.operationId,
              });
              storage.contractInstances.put({
                id: contractInstanceId,
                sourceGatekeeperId: instance.sourceGatekeeperId,
                artifactApprovalId: instance.artifactApprovalId,
                artifactHash: instance.artifactHash,
                runtimeProfileHash: instance.runtimeProfileHash,
                upstreamAuthority: structuredClone(instance.upstreamAuthority),
                placementDecision: {type: "taskDispatch", decisionId: dispatchId},
                intendedConsumer: taskConsumer,
                intendedRequirement: requirementReference,
                sharedState: structuredClone(requirement.sharedState),
                lifecycle: "prepared",
                generation: 1,
                revision: 1,
                createdSequence,
              });
              storage.bindingResolutions.put({
                id: resolutionId,
                consumer: taskConsumer,
                requirement: requirementReference,
                upstreamAuthority: structuredClone(instance.upstreamAuthority),
                verification: structuredClone(
                  storage.bindingResolutions.get(binding.resolutionId)?.verification ??
                    {type: "notRequired"},
                ),
                artifactApprovalId: requirement.artifactApprovalId,
                artifactApprovalEpoch: requirement.artifactApprovalEpoch,
                placementDecision: {type: "taskDispatch", decisionId: dispatchId},
                contractInstanceId,
                bindingId,
                sharedState: structuredClone(requirement.sharedState),
                expectedBindingGeneration: 0,
                evaluatorPolicyHash: requirement.evaluatorPolicyHash,
                upstreamBinding: structuredClone(requirement.standingBinding),
                createdSequence,
              });
              storage.bindings.put({
                id: bindingId,
                consumer: taskConsumer,
                name: requirement.name,
                requirement: requirementReference,
                contractInstanceId,
                resolutionId,
                status: "preparing",
                generation: 1,
                revision: 1,
                installedSequence: createdSequence,
              });
              return {
                name: requirement.name,
                required: requirement.required,
                requirementId: requirement.requirementId,
                resolutionId,
                contractInstanceId,
                bindingId,
                upstreamBinding: structuredClone(requirement.standingBinding),
              };
            });
            const leaseExpiresAt = Math.min(absoluteExpiresAt, input.requestedAt + 15 * 60_000);
            const correlation = {
              taskId,
              taskGeneration: 1,
              principal: structuredClone(input.principal),
              actorChain: [
                {type: <const>"workspacePrincipal", id: principal.id,
                  generation: principal.generation},
                {type: <const>"agentServiceWorkload", id: profile.workloadId,
                  generation: profile.workloadGeneration},
              ],
            };
            const task: AgentTaskRecord = {
              id: taskId,
              consumerId,
              generation: 1,
              dispatchDecisionId: dispatchId,
              templateApprovalId: approval.id,
              agentServiceProfileId: profile.id,
              agentServiceProfileGeneration: profile.generation,
              correlation,
              intentDigest: input.intentDigest,
              createdAt: input.requestedAt,
              absoluteExpiresAt,
              leaseGeneration: 1,
              leaseExpiresAt,
              environmentGeneration: 1,
              ratchetVersion: 1,
              lifecycle: "dispatching",
            };
            const environment: TaskEnvironmentRecord = {
              id: compositeKey(taskId, 1),
              taskId,
              taskGeneration: 1,
              generation: 1,
              ratchetVersion: 1,
              leaseGeneration: 1,
              leaseExpiresAt,
              absoluteExpiresAt,
              correlation,
              effectiveAuthorityDigest,
              bindings: environmentBindings,
              omittedOptionalRequirements: template.requirements.filter(requirement =>
                !requirement.required && !environmentBindings.some(binding =>
                  binding.requirementId === requirement.requirementId)).map(requirement => ({
                    requirementId: requirement.requirementId,
                    reason: <const>"unavailable",
                  })),
              state: "materializing",
            };
            storage.agentTasks.put(task);
            storage.taskEnvironments.put(environment);
            appendAuthorityEvent(storage, {
              type: "agentTaskDispatched",
              subjectId: taskId,
              operationId: input.operationId,
              afterGeneration: 1,
            });
            return {type: <const>"agentTaskDispatched", taskId,
              dispatchDecisionId: dispatchId, environmentId: environment.id};
          });
        case "terminateUnpublishedAgentTask":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const task = storage.agentTasks.get(command.taskId);
            if (!task || task.generation !== command.expectedTaskGeneration) {
              throw new Error("Agent Task generation is unavailable or stale.");
            }
            if (task.lifecycle === command.lifecycle) {
              return {type: <const>"agentTaskTerminated", taskId: task.id,
                generation: task.generation};
            }
            if (task.lifecycle !== "dispatching") {
              throw new Error("Published Agent Tasks require enforcement-first termination.");
            }
            const environment = storage.taskEnvironments.byTaskGeneration.get(
              compositeKey(task.id, task.environmentGeneration),
            );
            if (!environment || environment.state !== "materializing") {
              throw new Error("Unpublished Task Environment is unavailable.");
            }
            for (const placement of environment.bindings) {
              const binding = storage.bindings.get(placement.bindingId);
              const instance = storage.contractInstances.get(placement.contractInstanceId);
              if (!binding || binding.status !== "preparing" || binding.endpointSnapshot ||
                  !instance || instance.lifecycle !== "prepared" || instance.providerBacking) {
                throw new Error("Task placement reached enforcement and requires durable invalidation.");
              }
              storage.bindings.put({
                ...binding,
                status: "retracted",
                generation: binding.generation + 1,
                revision: binding.revision + 1,
              });
              storage.contractInstances.put({
                ...instance,
                lifecycle: "retracted",
                generation: instance.generation + 1,
                revision: instance.revision + 1,
              });
            }
            storage.taskEnvironments.put({...environment, state: "invalidated"});
            const generation = task.generation + 1;
            storage.agentTasks.put({...task, generation, lifecycle: command.lifecycle});
            appendAuthorityEvent(storage, {
              type: "agentTaskChanged",
              subjectId: task.id,
              operationId: command.operationId,
              beforeGeneration: task.generation,
              afterGeneration: generation,
            });
            return {type: <const>"agentTaskTerminated", taskId: task.id, generation};
          });
        case "prepareContractInstance":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const approval = requireActiveApproval(storage, command.record.artifactApprovalId);
            if (approval.artifactHash !== command.record.artifactHash) {
              throw new Error("Contract Instance Artifact does not match its Artifact Approval.");
            }
            const placementDecision = validatePlacementDecision(
              storage,
              command.record.placementDecision,
            );
            if (!sameAuthorityValue(
              placementDecision.consumer,
              command.record.intendedConsumer,
            )) {
              throw new Error("Contract Instance Consumer differs from its placement decision.");
            }
            const requirementAccepted = "requirements" in placementDecision
              ? placementDecision.requirements.some(requirement =>
                  sameAuthorityValue(requirement, command.record.intendedRequirement))
              : sameAuthorityValue(
                  placementDecision.requirement,
                  command.record.intendedRequirement,
                );
            if (!requirementAccepted) {
              throw new Error("Contract Instance requirement differs from its placement decision.");
            }
            const placementKey = compositeKey(
              command.record.placementDecision.type,
              command.record.placementDecision.decisionId,
              command.record.intendedRequirement?.requirementId ?? "",
            );
            const existing = storage.contractInstances.byPlacementDecision.get(placementKey);
            if (existing) {
              const {
                id: _id,
                legacyWorkpieceId: _legacyWorkpieceId,
                providerBacking: _providerBacking,
                lifecycle: _lifecycle,
                generation: _generation,
                revision: _revision,
                createdSequence: _createdSequence,
                ...actual
              } = existing;
              if (!sameAuthorityValue(actual, command.record)) {
                throw new Error("Placement Decision was reused for another Contract Instance.");
              }
              return {
                type: "contractInstancePrepared",
                id: existing.id,
                sequence: existing.createdSequence,
              };
            }
            const id = issueAuthorityId<"contractInstance">();
            const sequence = appendAuthorityEvent(storage, {
              type: "contractInstancePrepared",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.contractInstances.put({
              ...structuredClone(command.record),
              id,
              lifecycle: "prepared",
              generation: 1,
              revision: 1,
              createdSequence: sequence,
            });
            return {type: "contractInstancePrepared", id, sequence};
          });
        case "recordProviderBacking":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const instance = storage.contractInstances.get(command.contractInstanceId);
            if (!instance || instance.generation !== command.expectedInstanceGeneration ||
                (!instance.providerBacking && instance.lifecycle !== "prepared")) {
              throw new Error("Contract Instance is unavailable for provider backing.");
            }
            if (command.description.health !== "healthy" ||
                !sameAuthorityValue(command.description.identity, command.result.provider) ||
                command.result.contractInstance.id !== instance.id ||
                command.result.contractInstance.generation !== instance.generation ||
                command.result.state !== "prepared" ||
                command.result.cleanup !== "not-required" ||
                instance.upstreamAuthority.origin.type === "legacyGatekeeper" ||
                instance.upstreamAuthority.origin.id !== command.result.provider.accountId ||
                instance.upstreamAuthority.origin.generation !==
                  command.result.provider.sourceGeneration) {
              throw new Error("Provider backing differs from the approved Contract Instance tuple.");
            }
            const providerBacking = {
              provider: structuredClone(command.result.provider),
              backingReference: command.result.backingReference,
              capabilityGeneration: command.result.capabilityGeneration,
              providerNativeScope: structuredClone(command.description.providerNativeScope),
              providerNativeRevocationGranularity:
                command.description.providerNativeRevocationGranularity,
              localEnforcementRevocationGranularity:
                command.description.localEnforcementRevocationGranularity,
            };
            if (instance.providerBacking &&
                !sameAuthorityValue(instance.providerBacking, providerBacking)) {
              throw new Error("Provider backing changed across an exact retry.");
            }
            storage.contractInstances.put({...instance, providerBacking,
              revision: instance.revision + (instance.providerBacking ? 0 : 1)});
            return {type: "providerBackingRecorded", id: instance.id,
              capabilityGeneration: providerBacking.capabilityGeneration};
          });
        case "planBindingPublication":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            validateBindingName(command.name);
            const instance = storage.contractInstances.get(command.contractInstanceId);
            if (!instance || (instance.lifecycle !== "prepared" && instance.lifecycle !== "ready")) {
              throw new Error(`Contract Instance is not publishable: ${command.contractInstanceId}`);
            }
            if (instance.intendedConsumer &&
                !sameAuthorityValue(instance.intendedConsumer, command.consumer)) {
              throw new Error("Contract Instance Consumer differs from the approved placement.");
            }
            if (instance.intendedRequirement &&
                !sameAuthorityValue(instance.intendedRequirement, command.requirement)) {
              throw new Error("Contract Instance requirement differs from the approved placement.");
            }
            const placementDecision = validatePlacementDecision(
              storage,
              instance.placementDecision,
            );
            if (!("requirements" in placementDecision)) {
              if (placementDecision.intendedBindingName !== command.name) {
                throw new Error("Binding name differs from its Installation Decision.");
              }
              if (placementDecision.expectedBindingGeneration !==
                    command.expectedBindingGeneration) {
                throw new Error("Binding generation differs from its Installation Decision.");
              }
            }
            const activeKey = compositeKey(command.consumer.consumerId, command.name);
            const existing = storage.bindingPublicationPlans.byOperation.get(command.operationId);
            if (existing) {
              const expected = {
                contractInstanceId: command.contractInstanceId,
                consumer: command.consumer,
                requirement: command.requirement,
                name: command.name,
                verification: command.verification,
                expectedBindingGeneration: command.expectedBindingGeneration,
                evaluatorPolicyHash: command.evaluatorPolicyHash,
              };
              const actual = {
                contractInstanceId: existing.contractInstanceId,
                consumer: existing.consumer,
                requirement: existing.requirement,
                name: existing.name,
                verification: existing.verification,
                expectedBindingGeneration: existing.expectedBindingGeneration,
                evaluatorPolicyHash: existing.evaluatorPolicyHash,
              };
              if (!sameAuthorityValue(actual, expected)) {
                throw new Error("Binding publication Operation was reused for another plan.");
              }
              return {
                type: <const>"bindingPublicationPlanned",
                planId: existing.id,
                bindingId: existing.bindingId,
                resolutionId: existing.resolutionId,
                generation: existing.targetBindingGeneration,
              };
            }
            const predecessor = storage.bindings.currentByConsumerName.get(activeKey);
            const actualGeneration = predecessor?.generation ?? 0;
            if (actualGeneration !== command.expectedBindingGeneration) {
              throw new Error(`Stale Binding generation: expected ` +
                `${command.expectedBindingGeneration}, current ${actualGeneration}.`);
            }
            const planId = issueAuthorityId<"bindingPublicationPlan">();
            const bindingId = issueAuthorityId<"binding">();
            const resolutionId = issueAuthorityId<"bindingResolution">();
            const generation = actualGeneration + 1;
            appendAuthorityEvent(storage, {
              type: "bindingPublicationPlanned",
              subjectId: planId,
              operationId: command.operationId,
              beforeGeneration: actualGeneration,
              afterGeneration: generation,
            });
            storage.bindingPublicationPlans.put({
              id: planId,
              operationId: command.operationId,
              contractInstanceId: command.contractInstanceId,
              consumer: structuredClone(command.consumer),
              requirement: structuredClone(command.requirement),
              name: command.name,
              verification: structuredClone(command.verification),
              evaluatorPolicyHash: command.evaluatorPolicyHash,
              expectedBindingGeneration: actualGeneration,
              targetBindingGeneration: generation,
              bindingId,
              resolutionId,
              ...(predecessor ? {predecessorId: predecessor.id} : {}),
              state: "planned",
            });
            return {type: "bindingPublicationPlanned", planId, bindingId, resolutionId, generation};
          });
        case "acknowledgeBindingEndpoint":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const plan = storage.bindingPublicationPlans.get(command.planId);
            if (!plan || plan.operationId !== command.operationId ||
                (plan.state !== "planned" && plan.state !== "endpointAcknowledged" &&
                 plan.state !== "invalidationPending" && plan.state !== "readyToCommit" &&
                 plan.state !== "committed")) {
              throw new Error("Binding publication plan is unavailable for endpoint acknowledgement.");
            }
            const instance = storage.contractInstances.get(plan.contractInstanceId);
            if (!instance) throw new Error("Planned Contract Instance is unavailable.");
            const snapshot = validatePublicationSnapshot(plan, instance, command.snapshot);
            if (command.acknowledgement.endpointId !== snapshot.endpointId ||
                command.acknowledgement.reachabilityGeneration !== snapshot.reachabilityGeneration) {
              throw new Error("Contract endpoint returned an invalid installation acknowledgement.");
            }
            if (plan.endpointSnapshot && !sameAuthorityValue(plan.endpointSnapshot, snapshot)) {
              throw new Error("Binding endpoint acknowledgement changed across retries.");
            }
            if (plan.state === "committed") {
              const committedIntent = storage.invalidationIntents.byPlan.get(plan.id);
              return {
                type: "bindingEndpointAcknowledged",
                planId: plan.id,
                ...(committedIntent ? {invalidationIntentId: committedIntent.id} : {}),
              };
            }
            let intent = storage.invalidationIntents.byPlan.get(plan.id);
            if (plan.predecessorId && !intent) {
              const predecessor = storage.bindings.get(plan.predecessorId);
              if (!predecessor?.endpointSnapshot || predecessor.status !== "active" ||
                  predecessor.generation !== plan.expectedBindingGeneration) {
                throw new Error("Predecessor Binding lacks an active acknowledged endpoint.");
              }
              const intentId = issueAuthorityId<"invalidationIntent">();
              appendAuthorityEvent(storage, {
                type: "invalidationStarted",
                subjectId: predecessor.id,
                operationId: plan.operationId,
                beforeGeneration: predecessor.generation,
                afterGeneration: plan.targetBindingGeneration,
              });
              intent = {
                id: intentId,
                operationId: plan.operationId,
                planId: plan.id,
                bindingId: predecessor.id,
                bindingGeneration: predecessor.generation,
                endpointSnapshot: structuredClone(predecessor.endpointSnapshot),
                replacementBindingId: plan.bindingId,
                replacementGeneration: plan.targetBindingGeneration,
                state: "pending",
              };
              storage.invalidationIntents.put(intent);
            }
            storage.bindingPublicationPlans.put({
              ...plan,
              endpointSnapshot: structuredClone(snapshot),
              state: intent ? "invalidationPending" : "readyToCommit",
            });
            return {
              type: "bindingEndpointAcknowledged",
              planId: plan.id,
              ...(intent ? {invalidationIntentId: intent.id} : {}),
            };
          });
        case "acknowledgeBindingInvalidation":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const plan = storage.bindingPublicationPlans.get(command.planId);
            const intent = storage.invalidationIntents.byPlan.get(command.planId);
            if (!plan || !intent || plan.operationId !== command.operationId ||
                intent.operationId !== command.operationId ||
                (intent.state !== "pending" && intent.state !== "acknowledged" &&
                 intent.state !== "committed")) {
              throw new Error("Binding invalidation intent is unavailable.");
            }
            if (command.acknowledgement.endpointId !== intent.endpointSnapshot.endpointId ||
                command.acknowledgement.reachabilityGeneration !== intent.bindingGeneration ||
                command.acknowledgement.invalidated !== true) {
              throw new Error("Contract endpoint returned an invalid invalidation acknowledgement.");
            }
            if (intent.state !== "committed") {
              storage.invalidationIntents.put({...intent, state: "acknowledged"});
              storage.bindingPublicationPlans.put({...plan, state: "readyToCommit"});
            }
            return {type: "bindingInvalidationAcknowledged", planId: plan.id};
          });
        case "commitBindingPublication":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const plan = storage.bindingPublicationPlans.get(command.planId);
            if (!plan || plan.operationId !== command.operationId ||
                (plan.state !== "readyToCommit" && plan.state !== "committed") ||
                !plan.endpointSnapshot) {
              throw new Error("Binding publication plan is not ready to commit.");
            }
            if (plan.state === "committed") {
              const binding = storage.bindings.get(plan.bindingId);
              if (!binding || binding.generation !== plan.targetBindingGeneration) {
                throw new Error("Committed Binding publication differs from canonical state.");
              }
              const event = [...storage.workspaceAuthorityEvents.list()].find(candidate =>
                candidate.type === "bindingPublished" && candidate.subjectId === binding.id &&
                candidate.operationId === command.operationId);
              if (!event) throw new Error("Committed Binding publication is missing its event.");
              return {type: "bindingPublished", bindingId: binding.id,
                resolutionId: binding.resolutionId, generation: binding.generation,
                sequence: event.sequence};
            }
            const instance = storage.contractInstances.get(plan.contractInstanceId);
            if (!instance || (instance.lifecycle !== "prepared" && instance.lifecycle !== "ready")) {
              throw new Error("Planned Contract Instance is no longer publishable.");
            }
            const activeKey = compositeKey(plan.consumer.consumerId, plan.name);
            const predecessor = storage.bindings.currentByConsumerName.get(activeKey);
            const actualGeneration = predecessor?.generation ?? 0;
            if (actualGeneration !== plan.expectedBindingGeneration ||
                predecessor?.id !== plan.predecessorId) {
              const sequence = appendAuthorityEvent(storage, {
                type: "contractInstanceRetracted",
                subjectId: instance.id,
                operationId: command.operationId,
                beforeGeneration: instance.generation,
                afterGeneration: instance.generation + 1,
              });
              transitionContractInstance(
                storage,
                instance.id,
                "retracted",
                sequence,
                "binding-publication-stale-cas",
              );
              rootProviderCleanupEffect(storage, instance, {
                id: plan.bindingId,
                consumer: plan.consumer,
                name: plan.name,
                requirement: plan.requirement,
                contractInstanceId: instance.id,
                resolutionId: plan.resolutionId,
                status: "retracted",
                generation: plan.targetBindingGeneration,
                revision: 1,
                installedSequence: sequence,
                endpointSnapshot: plan.endpointSnapshot,
              }, command.operationId, true);
              storage.bindingPublicationPlans.put({...plan, state: "obsolete"});
              return {type: "bindingPublicationObsolete", planId: plan.id, reason: <const>"staleCas"};
            }
            const intent = storage.invalidationIntents.byPlan.get(plan.id);
            if (predecessor && (!intent || intent.state !== "acknowledged" ||
                intent.bindingId !== predecessor.id ||
                intent.bindingGeneration !== predecessor.generation)) {
              throw new Error("Predecessor invalidation has not been acknowledged.");
            }
            const sequence = appendAuthorityEvent(storage, {
              type: "bindingPublished",
              subjectId: plan.bindingId,
              operationId: command.operationId,
              beforeGeneration: actualGeneration,
              afterGeneration: plan.targetBindingGeneration,
            });
            if (predecessor) {
              const predecessorInstance = storage.contractInstances.get(
                predecessor.contractInstanceId,
              );
              if (!predecessorInstance) {
                throw new Error("Predecessor Contract Instance disappeared before publication.");
              }
              storage.bindings.put({...predecessor, status: "retracted",
                generation: plan.targetBindingGeneration, revision: predecessor.revision + 1});
              transitionContractInstance(storage, predecessor.contractInstanceId, "retracted",
                sequence, "binding-replaced");
              storage.authorityTombstones.put({
                id: issueAuthorityId<"authorityTombstone">(),
                subject: {type: "binding", id: predecessor.id},
                lineage: predecessor.predecessorId,
                terminalReason: "binding-replaced",
                terminalSequence: sequence,
                cleanup: "pending",
              });
              storage.invalidationIntents.put({...intent!, state: "committed"});
              rootProviderCleanupEffect(
                storage,
                predecessorInstance,
                predecessor,
                command.operationId,
              );
            }
            const resolution: BindingResolutionRecord = {
              id: plan.resolutionId,
              consumer: structuredClone(plan.consumer),
              requirement: structuredClone(plan.requirement),
              upstreamAuthority: structuredClone(instance.upstreamAuthority),
              verification: structuredClone(plan.verification),
              artifactApprovalId: instance.artifactApprovalId,
              artifactApprovalEpoch: requireActiveApproval(storage, instance.artifactApprovalId)
                .approvalEpoch,
              placementDecision: structuredClone(instance.placementDecision),
              contractInstanceId: instance.id,
              bindingId: plan.bindingId,
              sharedState: structuredClone(instance.sharedState),
              expectedBindingGeneration: plan.expectedBindingGeneration,
              evaluatorPolicyHash: plan.evaluatorPolicyHash,
              createdSequence: sequence,
            };
            const binding: BindingRecord = {
              id: plan.bindingId,
              consumer: structuredClone(plan.consumer),
              name: plan.name,
              requirement: structuredClone(plan.requirement),
              contractInstanceId: instance.id,
              resolutionId: plan.resolutionId,
              status: "active",
              generation: plan.targetBindingGeneration,
              revision: 1,
              installedSequence: sequence,
              endpointSnapshot: structuredClone(plan.endpointSnapshot),
              ...(predecessor ? {predecessorId: predecessor.id} : {}),
            };
            storage.bindingResolutions.put(resolution);
            storage.contractInstances.put({...instance, lifecycle: "ready", revision: instance.revision + 1});
            storage.bindings.put(binding);
            storage.bindingPublicationPlans.put({...plan, state: "committed"});
            return {type: "bindingPublished", bindingId: plan.bindingId,
              resolutionId: plan.resolutionId, generation: plan.targetBindingGeneration, sequence};
          });
        case "beginBindingInvalidation":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const existing = storage.invalidationIntents.byOperation.get(command.operationId);
            if (existing) {
              if (existing.bindingId !== command.bindingId ||
                  existing.bindingGeneration !== command.expectedGeneration ||
                  existing.terminalTarget !== command.terminalTarget ||
                  existing.reason !== command.reason) {
                throw new Error("Binding invalidation Operation was reused for another intent.");
              }
              return {type: "bindingInvalidationPlanned", intentId: existing.id};
            }
            const current = storage.bindings.get(command.bindingId);
            if (!current || current.status === "retracted" || !current.endpointSnapshot) {
              throw new Error(`Binding is not mutable: ${command.bindingId}`);
            }
            if (current.generation !== command.expectedGeneration) {
              throw new Error(`Stale Binding generation: expected ${command.expectedGeneration}, ` +
                `current ${current.generation}.`);
            }
            const intentId = issueAuthorityId<"invalidationIntent">();
            const intentSequence = appendAuthorityEvent(storage, {
              type: "invalidationStarted",
              subjectId: current.id,
              operationId: command.operationId,
              beforeGeneration: current.generation,
              afterGeneration: current.generation + 1,
            });
            storage.invalidationIntents.put({
              id: intentId,
              operationId: command.operationId,
              bindingId: current.id,
              bindingGeneration: current.generation,
              endpointSnapshot: structuredClone(current.endpointSnapshot),
              terminalTarget: command.terminalTarget,
              reason: command.reason,
              state: "pending",
            });
            const instance = storage.contractInstances.get(current.contractInstanceId);
            if (instance?.runtimeWorkpieceId !== undefined) {
              const effectId = issueAuthorityId<"authorityEffect">();
              const effectSequence = appendAuthorityEvent(storage, {
                type: "authorityEffectCreated",
                subjectId: effectId,
                operationId: command.operationId,
              });
              storage.workspaceAuthorityEffects.put({
                id: effectId,
                operationId: command.operationId,
                stepKey: `invalidate-terminal:${current.id}:${current.generation}`,
                kind: "invalidateTerminalEndpoint",
                targetId: instance.id,
                lane: `contract-instance:${instance.id}`,
                causalSequence: Math.max(intentSequence, effectSequence),
                inputDigest: current.endpointSnapshot.authoritySnapshotDigest,
                intentId,
                runtimeWorkpieceId: instance.runtimeWorkpieceId,
                endpointSnapshot: structuredClone(current.endpointSnapshot),
                state: "pending",
                attempt: 0,
                nextAttemptAt: 0,
                cleanupResponsibility: false,
              });
            }
            return {type: "bindingInvalidationPlanned", intentId};
          });
        case "acknowledgeTerminalBindingInvalidation":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const intent = storage.invalidationIntents.get(command.intentId);
            if (!intent || intent.operationId !== command.operationId ||
                !intent.terminalTarget ||
                (intent.state !== "pending" && intent.state !== "acknowledged" &&
                 intent.state !== "committed")) {
              throw new Error("Terminal Binding invalidation intent is unavailable.");
            }
            if (command.acknowledgement.endpointId !== intent.endpointSnapshot.endpointId ||
                command.acknowledgement.reachabilityGeneration !==
                  intent.endpointSnapshot.reachabilityGeneration ||
                command.acknowledgement.invalidated !== true) {
              throw new Error("Contract endpoint returned an invalid invalidation acknowledgement.");
            }
            if (intent.state !== "committed") {
              storage.invalidationIntents.put({...intent, state: "acknowledged"});
            }
            return {type: "terminalBindingInvalidationAcknowledged", intentId: intent.id};
          });
        case "commitTerminalBindingInvalidation":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const intent = storage.invalidationIntents.get(command.intentId);
            if (!intent || intent.operationId !== command.operationId ||
                !intent.terminalTarget ||
                (intent.state !== "acknowledged" && intent.state !== "committed")) {
              throw new Error("Terminal Binding invalidation is not ready to commit.");
            }
            const current = storage.bindings.get(intent.bindingId);
            if (intent.state === "committed") {
              const expectedStatus = intent.terminalTarget === "retracted" ? "retracted" : "suspended";
              if (!current || current.status !== expectedStatus ||
                  current.generation !== intent.bindingGeneration + 1) {
                throw new Error("Committed Binding invalidation differs from canonical state.");
              }
              const event = [...storage.workspaceAuthorityEvents.list()].find(candidate =>
                candidate.operationId === command.operationId &&
                candidate.subjectId === current.id &&
                (candidate.type === "bindingRetracted" || candidate.type === "bindingSuspended"));
              if (!event) throw new Error("Committed Binding invalidation is missing its event.");
              return {
                type: intent.terminalTarget === "retracted"
                  ? <const>"bindingRetracted"
                  : <const>"bindingSuspended",
                generation: current.generation,
                sequence: event.sequence,
              };
            }
            if (!current || current.status === "retracted" ||
                current.generation !== intent.bindingGeneration) {
              throw new Error("Terminal Binding invalidation lost its generation precondition.");
            }
            const instance = storage.contractInstances.get(current.contractInstanceId);
            if (!instance) throw new Error("Terminal Contract Instance is unavailable.");
            const generation = current.generation + 1;
            const retracted = intent.terminalTarget === "retracted";
            const sequence = appendAuthorityEvent(storage, {
              type: retracted ? "bindingRetracted" : "bindingSuspended",
              subjectId: current.id,
              operationId: command.operationId,
              beforeGeneration: current.generation,
              afterGeneration: generation,
            });
            storage.bindings.put({...current,
              status: retracted ? "retracted" : "suspended",
              generation, revision: current.revision + 1});
            transitionContractInstance(storage, current.contractInstanceId,
              retracted ? "retracted" : "suspended", sequence, intent.reason!);
            storage.invalidationIntents.put({...intent, state: "committed"});
            if (retracted) {
              storage.authorityTombstones.put({
                id: issueAuthorityId<"authorityTombstone">(),
                subject: {type: "binding", id: current.id},
                lineage: current.predecessorId,
                terminalReason: intent.reason!,
                terminalSequence: sequence,
                cleanup: "pending",
              });
              rootProviderCleanupEffect(storage, instance, current, command.operationId);
            }
            return {type: retracted ? "bindingRetracted" : "bindingSuspended", generation, sequence};
          });
        case "requestRuntimeApproval":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const binding = storage.bindings.get(command.record.bindingId);
            if (!binding || binding.status !== "active" ||
                binding.generation !== command.record.bindingGeneration) {
              throw new Error("Runtime Approval Request cites a stale or inactive Binding.");
            }
            const id = issueAuthorityId<"runtimeApprovalRequest">();
            const sequence = appendAuthorityEvent(storage, {
              type: "runtimeApprovalRequested",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.runtimeApprovalRequests.put({
              ...structuredClone(command.record),
              id,
              state: "pending",
              revision: 1,
            });
            return {type: "runtimeApprovalRequested", id, sequence};
          });
        case "decideRuntimeApproval":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const request = storage.runtimeApprovalRequests.get(command.record.requestId);
            if (!request || request.state !== "pending") {
              throw new Error("Runtime Approval Request is not pending.");
            }
            const binding = storage.bindings.get(request.bindingId);
            if (!binding || binding.status !== "active" ||
                binding.generation !== request.bindingGeneration) {
              throw new Error("Runtime Approval cannot restore a stale or inactive Binding.");
            }
            const id = issueAuthorityId<"runtimeApprovalDecision">();
            const sequence = appendAuthorityEvent(storage, {
              type: "runtimeApprovalDecided",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.runtimeApprovalDecisions.put({...structuredClone(command.record), id});
            storage.runtimeApprovalRequests.put({...request, state: "decided", revision: request.revision + 1});
            return {type: "runtimeApprovalDecided", id, sequence};
          });
        case "recordAuthorityDebt":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            if (command.record.bindingId) {
              const bindingExists = storage.bindings.get(command.record.bindingId) !== undefined;
              const plannedBindingExists = [...storage.bindingPublicationPlans.list()].some(
                plan => plan.bindingId === command.record.bindingId && plan.state !== "obsolete",
              );
              if (!bindingExists && !plannedBindingExists) {
                throw new Error(`No such planned or published Binding: ${command.record.bindingId}`);
              }
              const existing = storage.authorityDebts.byBinding.get(command.record.bindingId);
              if (existing) {
                const {id: _id, revision: _revision, ...actual} = existing;
                if (!sameAuthorityValue(actual, command.record)) {
                  throw new Error("Binding Authority Debt changed across an exact retry.");
                }
                const event = [...storage.workspaceAuthorityEvents.list()].find(candidate =>
                  candidate.type === "authorityDebtRecorded" && candidate.subjectId === existing.id);
                if (!event) throw new Error("Authority Debt is missing its Authority Event.");
                return {type: "authorityDebtRecorded", id: existing.id, sequence: event.sequence};
              }
            }
            const id = issueAuthorityId<"authorityDebt">();
            const sequence = appendAuthorityEvent(storage, {
              type: "authorityDebtRecorded",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.authorityDebts.put({...structuredClone(command.record), id, revision: 1});
            return {type: "authorityDebtRecorded", id, sequence};
          });
        case "mapLegacyConsumer":
          if (requireAuthorityState(storage).state === "active") {
            throw new Error("Legacy identity mapping is closed after cutover.");
          }
          return {
            type: "legacyConsumerMapped",
            id: mapLegacyIdentity(storage, "consumer", command.legacyWorkpieceId),
          };
        case "mapLegacySource":
          if (requireAuthorityState(storage).state === "active") {
            throw new Error("Legacy identity mapping is closed after cutover.");
          }
          return {
            type: "legacySourceMapped",
            id: mapLegacyIdentity(storage, "source", command.legacyWorkpieceId),
          };
        case "mapLegacyRequirement":
          if (requireAuthorityState(storage).state === "active") {
            throw new Error("Legacy identity mapping is closed after cutover.");
          }
          return {
            type: "legacyRequirementMapped",
            id: mapLegacyIdentity(storage, "requirement", command.legacyKey),
          };
      }
    },
    query(query) {
      switch (query.type) {
        case "status":
          return {type: "status", value: status(storage)};
        case "cutoverCandidate": {
          const state = requireAuthorityState(storage);
          if (state.state !== "backfilling" && state.state !== "readyToCutover") {
            throw new Error(`No cutover candidate while authority is ${state.state}.`);
          }
          return {type: "cutoverCandidate", value: migrationSnapshot(storage)};
        }
        case "artifactApproval":
          return {
            type: "artifactApproval",
            value: requireAuthorityState(storage).state === "active"
              ? storage.artifactApprovals.get(query.id)
              : undefined,
          };
        case "artifactApprovalByProposal":
          return {
            type: "artifactApprovalByProposal",
            value: requireAuthorityState(storage).state === "active"
              ? storage.artifactApprovals.byProposal.get(query.proposalId)
              : undefined,
          };
        case "artifactProposal":
          return {
            type: "artifactProposal",
            value: requireAuthorityState(storage).state === "active"
              ? storage.artifactProposals.get(query.id)
              : undefined,
          };
        case "installationDecision":
          return {
            type: "installationDecision",
            value: requireAuthorityState(storage).state === "active"
              ? storage.installationDecisions.get(query.id)
              : undefined,
          };
        case "installationDecisionByOperation":
          return {
            type: "installationDecisionByOperation",
            value: requireAuthorityState(storage).state === "active"
              ? storage.installationDecisions.byOperation.get(query.operationId)
              : undefined,
          };
        case "taskDispatchDecision":
          return {
            type: "taskDispatchDecision",
            value: requireAuthorityState(storage).state === "active"
              ? storage.taskDispatchDecisions.get(query.id)
              : undefined,
          };
        case "agentServiceProfile":
          return {
            type: "agentServiceProfile",
            value: requireAuthorityState(storage).state === "active"
              ? storage.agentServiceProfiles.get(query.id)
              : undefined,
          };
        case "workspacePrincipal":
          return {
            type: "workspacePrincipal",
            value: requireAuthorityState(storage).state === "active"
              ? storage.workspacePrincipals.get(query.id)
              : undefined,
          };
        case "taskTemplateVersion":
          return {
            type: "taskTemplateVersion",
            value: requireAuthorityState(storage).state === "active"
              ? storage.taskTemplateVersions.get(query.id)
              : undefined,
          };
        case "taskTemplateApproval":
          return {
            type: "taskTemplateApproval",
            value: requireAuthorityState(storage).state === "active"
              ? storage.taskTemplateApprovals.get(query.id)
              : undefined,
          };
        case "agentTask":
          return {
            type: "agentTask",
            value: requireAuthorityState(storage).state === "active"
              ? storage.agentTasks.get(query.id)
              : undefined,
          };
        case "taskEnvironment":
          return {
            type: "taskEnvironment",
            value: requireAuthorityState(storage).state === "active"
              ? storage.taskEnvironments.byTaskGeneration.get(
                  compositeKey(query.taskId, query.generation),
                )
              : undefined,
          };
        case "contractInstance":
          return {
            type: "contractInstance",
            value: requireAuthorityState(storage).state === "active"
              ? storage.contractInstances.get(query.id)
              : undefined,
          };
        case "binding":
          return {
            type: "binding",
            value: requireAuthorityState(storage).state === "active"
              ? storage.bindings.get(query.id)
              : undefined,
          };
        case "bindingByConsumerName":
          return {
            type: "bindingByConsumerName",
            value: requireAuthorityState(storage).state === "active"
              ? storage.bindings.currentByConsumerName.get(
                  compositeKey(query.consumerId, query.name),
                )
              : undefined,
          };
        case "bindingByInstance":
          return {
            type: "bindingByInstance",
            value: requireAuthorityState(storage).state === "active"
              ? [...storage.bindings.byInstance.get(query.contractInstanceId)]
                .toSorted((left, right) => right.generation - left.generation)[0]
              : undefined,
          };
        case "bindingResolution":
          return {
            type: "bindingResolution",
            value: requireAuthorityState(storage).state === "active"
              ? storage.bindingResolutions.get(query.id)
              : undefined,
          };
        case "bindingPublicationPlan":
          return {
            type: "bindingPublicationPlan",
            value: requireAuthorityState(storage).state === "active"
              ? storage.bindingPublicationPlans.get(query.id)
              : undefined,
          };
        case "invalidationIntentByPlan":
          return {
            type: "invalidationIntentByPlan",
            value: requireAuthorityState(storage).state === "active"
              ? storage.invalidationIntents.byPlan.get(query.planId)
              : undefined,
          };
        case "invalidationIntentByOperation":
          return {
            type: "invalidationIntentByOperation",
            value: requireAuthorityState(storage).state === "active"
              ? storage.invalidationIntents.byOperation.get(query.operationId)
              : undefined,
          };
        case "bindingExecution": {
          if (requireAuthorityState(storage).state !== "active") {
            return {type: "bindingExecution", value: undefined};
          }
          const binding = storage.bindings.currentByConsumerName.get(
            compositeKey(query.consumerId, query.name),
          );
          if (!binding || binding.status !== "active" ||
              Array.from(storage.invalidationIntents.byBinding.get(binding.id))
                .some(intent => intent.state !== "committed")) {
            return {type: "bindingExecution", value: undefined};
          }
          const instance = storage.contractInstances.get(binding.contractInstanceId);
          return {
            type: "bindingExecution",
            value: instance?.lifecycle === "ready"
              ? {binding, instance}
              : undefined,
          };
        }
        case "bindingExecutionByInstance": {
          if (requireAuthorityState(storage).state !== "active") {
            return {type: "bindingExecutionByInstance", value: undefined};
          }
          const binding = Array.from(storage.bindings.byInstance.get(query.contractInstanceId))
            .find(candidate => candidate.status === "active");
          if (!binding || Array.from(storage.invalidationIntents.byBinding.get(binding.id))
            .some(intent => intent.state !== "committed")) {
            return {type: "bindingExecutionByInstance", value: undefined};
          }
          const instance = storage.contractInstances.get(binding.contractInstanceId);
          return {
            type: "bindingExecutionByInstance",
            value: instance?.lifecycle === "ready" ? {binding, instance} : undefined,
          };
        }
        case "consumerReadiness": {
          if (requireAuthorityState(storage).state !== "active") {
            return {type: "consumerReadiness", value: {ready: false, generation: 0}};
          }
          const required = [...storage.installationDecisions.list()].filter(decision =>
            decision.decision === "approved" &&
            decision.consumer?.consumerId === query.consumerId &&
            decision.requirement !== undefined &&
            decision.intendedBindingName !== undefined,
          );
          const bindings = [...storage.bindings.byConsumer.get(query.consumerId)]
            .filter(binding => binding.status !== "retracted");
          const generation = bindings.reduce(
            (highest, binding) => Math.max(highest, binding.generation),
            0,
          );
          const ready = required.length > 0 && required.every(decision => {
            const binding = bindings.find(candidate =>
              candidate.name === decision.intendedBindingName &&
              sameAuthorityValue(candidate.requirement, decision.requirement));
            if (!binding) return false;
            if (binding.status !== "active" ||
                [...storage.invalidationIntents.byBinding.get(binding.id)]
                  .some(intent => intent.state !== "committed")) return false;
            return storage.contractInstances.get(binding.contractInstanceId)?.lifecycle === "ready";
          });
          return {type: "consumerReadiness", value: {ready, generation}};
        }
        case "consumerEnvironment": {
          if (requireAuthorityState(storage).state !== "active") {
            return {type: "consumerEnvironment", value: {
              ready: false, generation: 0, bindings: [],
            }};
          }
          const required = [...storage.installationDecisions.list()].filter(decision =>
            decision.decision === "approved" &&
            decision.consumer?.consumerId === query.consumerId &&
            decision.requirement !== undefined &&
            decision.intendedBindingName !== undefined,
          );
          const candidates = [...storage.bindings.byConsumer.get(query.consumerId)]
            .filter(binding => binding.status !== "retracted")
            .toSorted((left, right) => left.name.localeCompare(right.name));
          const generation = candidates.reduce(
            (highest, binding) => Math.max(highest, binding.generation),
            0,
          );
          const bindings = candidates.flatMap(binding => {
            if (binding.status !== "active" ||
                [...storage.invalidationIntents.byBinding.get(binding.id)]
                  .some(intent => intent.state !== "committed")) return [];
            const instance = storage.contractInstances.get(binding.contractInstanceId);
            const resolution = storage.bindingResolutions.get(binding.resolutionId);
            return instance?.lifecycle === "ready" && resolution
              ? [{binding, instance, resolution}]
              : [];
          });
          const ready = required.length > 0 && required.every(decision =>
            bindings.some(candidate =>
              candidate.binding.name === decision.intendedBindingName &&
              sameAuthorityValue(candidate.binding.requirement, decision.requirement)),
          );
          return {type: "consumerEnvironment", value: {ready, generation, bindings}};
        }
        case "runtimeApprovalRequest":
          return {
            type: "runtimeApprovalRequest",
            value: requireAuthorityState(storage).state === "active"
              ? storage.runtimeApprovalRequests.get(query.id)
              : undefined,
          };
        case "runtimeApprovalDecision":
          return {
            type: "runtimeApprovalDecision",
            value: requireAuthorityState(storage).state === "active"
              ? storage.runtimeApprovalDecisions.get(query.id)
              : undefined,
          };
        case "authorityDebt":
          return {
            type: "authorityDebt",
            value: requireAuthorityState(storage).state === "active"
              ? storage.authorityDebts.get(query.id)
              : undefined,
          };
        case "authorityDebtByBinding":
          return {
            type: "authorityDebtByBinding",
            value: requireAuthorityState(storage).state === "active"
              ? storage.authorityDebts.byBinding.get(query.bindingId)
              : undefined,
          };
        case "authorityTombstoneBySubject":
          return {
            type: "authorityTombstoneBySubject",
            value: requireAuthorityState(storage).state === "active"
              ? storage.authorityTombstones.bySubject.get(
                  compositeKey(query.subjectType, query.subjectId),
                )
              : undefined,
          };
      }
    },
    reconcile() {
      const now = Date.now();
      const dueEnd = now < Number.MAX_SAFE_INTEGER ? now + 1 : now;
      let attemptedEffects = 0;
      storage.transaction(() => {
        for (const effect of Array.from(
          storage.workspaceAuthorityEffects.byDue.list({end: dueEnd}),
        )) {
          if (effect.state === "claimed" && effect.claimUntil !== undefined &&
              effect.claimUntil <= now) {
            storage.workspaceAuthorityEffects.put({
              ...effect,
              state: "outcomeUnknown",
              claimToken: undefined,
              claimUntil: undefined,
              nextAttemptAt: now,
              reason: "claimExpired",
            });
            attemptedEffects++;
          }
        }
      });
      return {attemptedEffects};
    },
    claimDueEffects(now, requestedLimit, createClaimToken) {
      return storage.transaction(() => {
        requireActiveAuthority(storage);
        const limit = Math.max(0, Math.min(16, Math.floor(requestedLimit)));
        const claimedLanes = new Set(
          [...storage.workspaceAuthorityEffects.byState.get("claimed")]
            .filter(effect => (effect.claimUntil ?? 0) > now)
            .map(effect => effect.lane),
        );
        const claimed: WorkspaceAuthorityEffect[] = [];
        const dueEffects = now >= Number.MAX_SAFE_INTEGER - 1
          ? storage.workspaceAuthorityEffects.byDue.list({limit: 16})
          : storage.workspaceAuthorityEffects.byDue.list({end: now + 1, limit: 16});
        for (const effect of Array.from(dueEffects)) {
          if (claimed.length >= limit) break;
          if ((effect.state !== "pending" && effect.state !== "retryScheduled" &&
               effect.state !== "outcomeUnknown") || effect.nextAttemptAt > now ||
              claimedLanes.has(effect.lane)) continue;
          const claimToken = createClaimToken();
          const next: WorkspaceAuthorityEffect = {
            ...effect,
            state: "claimed",
            attempt: effect.attempt + 1,
            firstAttemptAt: effect.firstAttemptAt ?? now,
            claimToken,
            claimUntil: Math.min(Number.MAX_SAFE_INTEGER - 1, now + 30_000),
            reason: undefined,
          };
          storage.workspaceAuthorityEffects.put(next);
          claimedLanes.add(effect.lane);
          claimed.push(structuredClone(next));
        }
        return claimed;
      });
    },
    startStandingInstallationEffect(input) {
      return storage.transaction(() => {
        requireActiveAuthority(storage);
        const existing = storage.workspaceAuthorityEffects.byInstallationOperation.get(
          input.command.operationId,
        );
        if (isStandingInstallationEffect(existing)) {
          if (existing.targetId !== input.contractInstanceId ||
              existing.decisionId !== input.decision.id ||
              existing.inputDigest !== input.requestDigest ||
              !sameAuthorityValue(existing.command, input.command) ||
              !sameAuthorityValue(existing.providerDescription, input.providerDescription)) {
            throw new Error("Standing installation Effect changed across an exact retry.");
          }
          return structuredClone(existing);
        }
        const operation = storage.authorityOperations.get(input.command.operationId);
        if (!operation || operation.actor !== input.decision.decidedBy ||
            operation.state !== "begun") {
          throw new Error("Standing installation Effect lacks its accepted Authority Operation.");
        }
        const id = issueAuthorityId<"authorityEffect">();
        const instance = storage.contractInstances.get(input.contractInstanceId);
        if (!instance?.intendedConsumer || !instance.intendedRequirement) {
          throw new Error("Standing installation Effect lacks its intended Binding tuple.");
        }
        const planned = authority.execute({
          type: "planBindingPublication",
          operationId: `${input.command.operationId}:publication`,
          contractInstanceId: instance.id,
          consumer: instance.intendedConsumer,
          requirement: instance.intendedRequirement,
          name: input.command.bindingName,
          verification: {type: "notRequired"},
          expectedBindingGeneration: input.command.expectedBindingGeneration,
          evaluatorPolicyHash: input.command.evaluatorPolicyHash,
        });
        if (planned.type !== "bindingPublicationPlanned") {
          throw new Error("Standing installation Effect could not plan Binding publication.");
        }
        const causalSequence = appendAuthorityEvent(storage, {
          type: "authorityEffectCreated",
          subjectId: id,
          operationId: input.command.operationId,
        });
        const effect: StandingInstallationEffect = {
          id,
          operationId: input.command.operationId,
          stepKey: input.command.stepKey,
          kind: "prepareProviderBacking",
          targetId: input.contractInstanceId,
          lane: `contract-instance:${input.contractInstanceId}`,
          causalSequence,
          inputDigest: input.requestDigest,
          decisionId: input.decision.id,
          command: structuredClone(input.command),
          principalId: input.decision.decidedBy,
          permissionGeneration: input.decision.permissionGeneration ?? 1,
          providerDescription: structuredClone(input.providerDescription),
          planId: planned.planId,
          bindingId: planned.bindingId,
          targetBindingGeneration: planned.generation,
          phase: "providerPrepare",
          state: "pending",
          attempt: 0,
          nextAttemptAt: 0,
          cleanupResponsibility: false,
        };
        storage.workspaceAuthorityEffects.put(effect);
        return structuredClone(effect);
      });
    },
    advanceStandingInstallationEffect(effectId, claimToken, phase) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (!isStandingInstallationEffect(effect) || effect.state !== "claimed" ||
            effect.claimToken !== claimToken) {
          throw new Error("Standing installation Effect claim is stale.");
        }
        storage.workspaceAuthorityEffects.put({...effect, phase});
      });
    },
    completeProviderPreparationEffect(effectId, claimToken, result, snapshot, debt) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (effect?.kind !== "prepareProviderBacking" || effect.state !== "claimed" ||
            effect.claimToken !== claimToken) {
          throw new Error("Provider preparation Effect claim is stale.");
        }
        const instance = storage.contractInstances.get(effect.targetId);
        const plan = storage.bindingPublicationPlans.get(effect.planId);
        if (!instance || !plan || plan.contractInstanceId !== instance.id ||
            plan.bindingId !== effect.bindingId ||
            plan.targetBindingGeneration !== effect.targetBindingGeneration) {
          throw new Error("Provider preparation Effect preconditions changed.");
        }
        requireActiveApproval(storage, instance.artifactApprovalId);
        authority.execute({
          type: "recordProviderBacking",
          operationId: effect.id,
          contractInstanceId: instance.id,
          expectedInstanceGeneration: instance.generation,
          description: effect.providerDescription,
          result,
        });
        validatePublicationSnapshot(plan, instance, snapshot);
        authority.execute({
          type: "recordAuthorityDebt",
          operationId: `${effect.operationId}:authority-debt`,
          record: debt,
        });
        succeedAuthorityEffect(storage, effect);
        const childId = issueAuthorityId<"authorityEffect">();
        const causalSequence = appendAuthorityEvent(storage, {
          type: "authorityEffectCreated",
          subjectId: childId,
          operationId: effect.operationId,
        });
        const child: InstallContractEndpointEffect = {
          ...standingEffectContext(effect),
          id: childId,
          operationId: effect.operationId,
          stepKey: `install-endpoint:${instance.id}`,
          kind: "installContractEndpoint",
          lane: effect.lane,
          causalSequence,
          inputDigest: snapshot.authoritySnapshotDigest,
          providerPrepared: structuredClone(result),
          snapshot: structuredClone(snapshot),
          phase: "endpointInstall",
          state: "pending",
          attempt: 0,
          nextAttemptAt: 0,
        };
        storage.workspaceAuthorityEffects.put(child);
      });
    },
    completeEndpointInstallationEffect(effectId, claimToken, acknowledgement) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (effect?.kind !== "installContractEndpoint" || effect.state !== "claimed" ||
            effect.claimToken !== claimToken) {
          throw new Error("Endpoint installation Effect claim is stale.");
        }
        if (acknowledgement.endpointId !== effect.snapshot.endpointId ||
            acknowledgement.reachabilityGeneration !== effect.snapshot.reachabilityGeneration) {
          throw new Error("Contract endpoint returned an invalid installation acknowledgement.");
        }
        const instance = storage.contractInstances.get(effect.targetId);
        const plan = storage.bindingPublicationPlans.get(effect.planId);
        if (!instance || !plan || !instance.providerBacking ||
            !sameAuthorityValue(instance.providerBacking.provider, effect.providerPrepared.provider) ||
            instance.providerBacking.capabilityGeneration !==
              effect.providerPrepared.capabilityGeneration ||
            !sameAuthorityValue(validatePublicationSnapshot(plan, instance, effect.snapshot),
              effect.snapshot)) {
          throw new Error("Endpoint installation Effect preconditions changed.");
        }
        requireActiveApproval(storage, instance.artifactApprovalId);
        succeedAuthorityEffect(storage, effect);
        const childId = issueAuthorityId<"authorityEffect">();
        const causalSequence = appendAuthorityEvent(storage, {
          type: "authorityEffectCreated",
          subjectId: childId,
          operationId: effect.operationId,
        });
        storage.workspaceAuthorityEffects.put({
          ...standingEffectContext(effect),
          id: childId,
          operationId: effect.operationId,
          stepKey: `activate-provider:${instance.id}`,
          kind: "activateProviderBacking",
          lane: effect.lane,
          causalSequence,
          inputDigest: effect.snapshot.authoritySnapshotDigest,
          providerPrepared: structuredClone(effect.providerPrepared),
          snapshot: structuredClone(effect.snapshot),
          endpointAcknowledgement: structuredClone(acknowledgement),
          phase: "providerActivate",
          state: "pending",
          attempt: 0,
          nextAttemptAt: 0,
          cleanupResponsibility: false,
        });
      });
    },
    completeProviderActivationEffect(effectId, claimToken, result) {
      return storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (effect?.kind !== "activateProviderBacking" || effect.state !== "claimed" ||
            effect.claimToken !== claimToken) {
          throw new Error("Provider activation Effect claim is stale.");
        }
        const instance = storage.contractInstances.get(effect.targetId);
        const plan = storage.bindingPublicationPlans.get(effect.planId);
        if (!instance || !plan || !instance.providerBacking ||
            result.state !== "active" || result.cleanup !== "not-required" ||
            result.capabilityGeneration !== effect.providerPrepared.capabilityGeneration ||
            !sameAuthorityValue(result.provider, effect.providerDescription.identity) ||
            !sameAuthorityValue(result.contractInstance,
              {id: instance.id, generation: instance.generation})) {
          throw new Error("Provider activation outcome differs from its exact Effect.");
        }
        requireActiveApproval(storage, instance.artifactApprovalId);
        const acknowledged = authority.execute({
          type: "acknowledgeBindingEndpoint",
          operationId: plan.operationId,
          planId: plan.id,
          snapshot: effect.snapshot,
          acknowledgement: effect.endpointAcknowledgement,
        });
        if (acknowledged.type !== "bindingEndpointAcknowledged") {
          throw new Error("Provider activation could not acknowledge the Contract endpoint.");
        }
        if (acknowledged.invalidationIntentId) {
          const intent = storage.invalidationIntents.get(acknowledged.invalidationIntentId);
          const predecessor = intent
            ? storage.bindings.get(intent.bindingId)
            : undefined;
          const predecessorInstance = predecessor
            ? storage.contractInstances.get(predecessor.contractInstanceId)
            : undefined;
          if (!intent || predecessorInstance?.runtimeWorkpieceId === undefined) {
            throw new Error("Replacement invalidation Effect lacks its predecessor runtime.");
          }
          succeedAuthorityEffect(storage, effect);
          const childId = issueAuthorityId<"authorityEffect">();
          const causalSequence = appendAuthorityEvent(storage, {
            type: "authorityEffectCreated",
            subjectId: childId,
            operationId: effect.operationId,
          });
          storage.workspaceAuthorityEffects.put({
            ...standingEffectContext(effect),
            id: childId,
            operationId: effect.operationId,
            stepKey: `invalidate-predecessor:${intent.bindingId}:${intent.bindingGeneration}`,
            kind: "invalidatePredecessorEndpoint",
            lane: `contract-instance:${predecessorInstance.id}`,
            causalSequence,
            inputDigest: intent.endpointSnapshot.authoritySnapshotDigest,
            providerPrepared: structuredClone(effect.providerPrepared),
            snapshot: structuredClone(effect.snapshot),
            endpointAcknowledgement: structuredClone(effect.endpointAcknowledgement),
            intentId: intent.id,
            predecessorRuntimeWorkpieceId: predecessorInstance.runtimeWorkpieceId,
            predecessorSnapshot: structuredClone(intent.endpointSnapshot),
            phase: "predecessorInvalidate",
            state: "pending",
            attempt: 0,
            nextAttemptAt: 0,
            cleanupResponsibility: false,
          });
          return undefined;
        }
        const published = authority.execute({
          type: "commitBindingPublication",
          operationId: plan.operationId,
          planId: plan.id,
        });
        if (published.type !== "bindingPublished") {
          // commitBindingPublication atomically retracts the unpublished instance and roots its
          // cleanup Effect on a stale CAS. Finish this exact external-call Effect without throwing
          // so the enclosing transaction preserves that compensation work.
          succeedAuthorityEffect(storage, effect);
          return undefined;
        }
        const installationResult: StandingBindingInstallationResult = {
          type: "standingBindingInstalled",
          installationDecisionId: effect.decisionId,
          contractInstanceId: effect.targetId,
          bindingId: published.bindingId,
          bindingResolutionId: published.resolutionId,
          bindingGeneration: published.generation,
        };
        authority.completeStandingInstallationEffect(effect.id, claimToken, installationResult);
        return installationResult;
      });
    },
    recordStandingInstallationEndpointOutcome(effectId, claimToken, acknowledgement) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (!isStandingInstallationEffect(effect) || effect.state !== "claimed" ||
            effect.claimToken !== claimToken) {
          throw new Error("Standing installation Effect claim is stale.");
        }
        if (effect.endpointAcknowledgement &&
            !sameAuthorityValue(effect.endpointAcknowledgement, acknowledgement)) {
          throw new Error("Contract endpoint acknowledgement changed across retries.");
        }
        storage.workspaceAuthorityEffects.put({
          ...effect,
          endpointAcknowledgement: structuredClone(acknowledgement),
          phase: "providerActivate",
        });
      });
    },
    completeStandingInstallationEffect(effectId, claimToken, result) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (!isStandingInstallationEffect(effect) || effect.state !== "claimed" ||
            effect.claimToken !== claimToken) {
          throw new Error("Standing installation Effect claim is stale.");
        }
        const operation = storage.authorityOperations.get(effect.operationId);
        if (!operation || operation.actor !== effect.principalId) {
          throw new Error("Standing installation Authority Operation is unavailable.");
        }
        const plan = storage.bindingPublicationPlans.get(effect.planId);
        const binding = storage.bindings.get(effect.bindingId);
        const instance = storage.contractInstances.get(effect.targetId);
        if (!plan || plan.state !== "committed" || !binding || !instance ||
            instance.lifecycle !== "ready" ||
            result.installationDecisionId !== effect.decisionId ||
            result.contractInstanceId !== effect.targetId ||
            result.bindingId !== effect.bindingId ||
            result.bindingResolutionId !== plan.resolutionId ||
            result.bindingGeneration !== effect.targetBindingGeneration ||
            binding.generation !== effect.targetBindingGeneration) {
          throw new Error("Standing installation outcome differs from canonical publication.");
        }
        requireActiveApproval(storage, instance.artifactApprovalId);
        if (operation.state === "completed" && !sameAuthorityValue(operation.result, result)) {
          throw new Error("Standing installation completed with another result.");
        }
        appendAuthorityEvent(storage, {
          type: "authorityEffectSucceeded",
          subjectId: effect.id,
          operationId: effect.operationId,
        });
        storage.workspaceAuthorityEffects.put({...effect, state: "succeeded",
          claimToken: undefined, claimUntil: undefined, reason: undefined});
        storage.authorityOperations.put({...operation, state: "completed",
          lastCompletedStep: effect.stepKey, result: structuredClone(result)});
      });
    },
    completeTerminalInvalidationEffect(effectId, claimToken, acknowledgement) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (effect?.kind !== "invalidateTerminalEndpoint" || effect.state !== "claimed" ||
            effect.claimToken !== claimToken) {
          throw new Error("Terminal invalidation Effect claim is stale.");
        }
        authority.execute({
          type: "acknowledgeTerminalBindingInvalidation",
          operationId: effect.operationId,
          intentId: effect.intentId,
          acknowledgement,
        });
        authority.execute({
          type: "commitTerminalBindingInvalidation",
          operationId: effect.operationId,
          intentId: effect.intentId,
        });
        appendAuthorityEvent(storage, {
          type: "authorityEffectSucceeded",
          subjectId: effect.id,
          operationId: effect.operationId,
        });
        storage.workspaceAuthorityEffects.put({...effect, state: "succeeded",
          claimToken: undefined, claimUntil: undefined, reason: undefined});
      });
    },
    completeEffect(effectId, claimToken) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (!effect || isStandingInstallationEffect(effect) ||
            effect.kind === "invalidateTerminalEndpoint") {
          throw new Error("Cleanup Authority Effect is unavailable.");
        }
        if (effect.state === "succeeded") return;
        if (effect.state !== "claimed" || effect.claimToken !== claimToken) {
          throw new Error("Authority Effect claim is stale.");
        }
        const tombstone = storage.authorityTombstones.bySubject.get(
          compositeKey("contractInstance", effect.targetId),
        );
        if (!tombstone || tombstone.cleanup !== "pending") {
          throw new Error("Authority Effect cleanup responsibility is unavailable.");
        }
        appendAuthorityEvent(storage, {
          type: "authorityEffectSucceeded",
          subjectId: effect.id,
          operationId: effect.operationId,
        });
        storage.workspaceAuthorityEffects.put({
          ...effect,
          state: "succeeded",
          claimToken: undefined,
          claimUntil: undefined,
          reason: undefined,
        });
        storage.authorityTombstones.put({...tombstone, cleanup: "complete"});
        for (const binding of storage.bindings.byInstance.get(effect.targetId)) {
          const bindingTombstone = storage.authorityTombstones.bySubject.get(
            compositeKey("binding", binding.id),
          );
          if (bindingTombstone?.cleanup === "pending") {
            storage.authorityTombstones.put({...bindingTombstone, cleanup: "complete"});
          }
        }
      });
    },
    retryEffect(effectId, claimToken, now) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        const effect = storage.workspaceAuthorityEffects.get(effectId);
        if (!effect || effect.state !== "claimed" || effect.claimToken !== claimToken) {
          throw new Error("Authority Effect claim is stale.");
        }
        const deadLetter = effect.attempt >= 12 ||
          (effect.firstAttemptAt !== undefined && now - effect.firstAttemptAt >= 24 * 60 * 60_000);
        if (deadLetter) {
          appendAuthorityEvent(storage, {
            type: "authorityEffectDeadLettered",
            subjectId: effect.id,
            operationId: effect.operationId,
          });
        }
        storage.workspaceAuthorityEffects.put({
          ...effect,
          state: deadLetter ? "deadLetter" : "retryScheduled",
          claimToken: undefined,
          claimUntil: undefined,
          nextAttemptAt: deadLetter ? effect.nextAttemptAt : Math.min(
            Number.MAX_SAFE_INTEGER - 1,
            now + effectRetryDelay(effect.id, effect.attempt),
          ),
          reason: "providerUnavailable",
        });
      });
    },
    nextEffectDueAt() {
      const next = [...storage.workspaceAuthorityEffects.byDue.list({limit: 1})][0];
      return next?.state === "claimed"
        ? next.claimUntil ?? next.nextAttemptAt
        : next?.nextAttemptAt;
    },
    resolveLegacyIdentity(kind, legacyId) {
      return storage.hostAuthorityIdentities.get(compositeKey(kind, legacyId))?.canonicalId ??
        findMappedLegacyIdentity(storage, kind, legacyId);
    },
    ensureHostIdentity(kind, hostId) {
      requireAuthorityState(storage);
      return storage.transaction(() => {
        const key = compositeKey(kind, hostId);
        const existing = storage.hostAuthorityIdentities.get(key);
        if (existing) return existing.canonicalId;
        const canonicalId = findMappedLegacyIdentity(storage, kind, hostId) ??
          issueAuthorityId<typeof kind>();
        const createdSequence = appendAuthorityEvent(storage, {
          type: "hostAuthorityIdentityIssued",
          subjectId: canonicalId,
        });
        storage.hostAuthorityIdentities.put({key, kind, hostId, canonicalId, createdSequence});
        return canonicalId;
      });
    },
    recordConsumerLifecycleEvent(event) {
      storage.transaction(() => {
        requireActiveAuthority(storage);
        appendAuthorityEvent(storage, structuredClone(event));
      });
    },
  };

  const compatibility: LegacyWorkspaceAuthorityCompatibility = {
    queryVisibleBindings({consumerId, forChatId}) {
      const gadget = requireGadget(adapter, consumerId);
      if (requireAuthorityState(storage).state !== "active") {
        return visibleBindings(gadget, forChatId);
      }
      const canonicalConsumerId =
        storage.hostAuthorityIdentities.get(compositeKey("consumer", consumerId))?.canonicalId ??
        findMappedLegacyIdentity(storage, "consumer", consumerId);
      if (!canonicalConsumerId) return [];
      const projected: [string, LegacyGadgetBindingRecord][] = [];
      for (const binding of storage.bindings.byConsumer.get(canonicalConsumerId as ConsumerId)) {
        if (binding.status !== "active" ||
            [...storage.invalidationIntents.byBinding.get(binding.id)]
              .some(intent => intent.state !== "committed")) continue;
        const instance = storage.contractInstances.get(binding.contractInstanceId);
        const runtimeWorkpieceId = instance?.runtimeWorkpieceId ?? instance?.legacyWorkpieceId;
        if (runtimeWorkpieceId === undefined) continue;
        const metadata = gadget.bindings[binding.name];
        projected.push([
          binding.name,
          {
            target: runtimeWorkpieceId,
            ...(metadata?.blueprintAnnotation
              ? {blueprintAnnotation: metadata.blueprintAnnotation}
              : {}),
          },
        ]);
      }
      return projected;
    },
    bindContract({consumerId, name, contractId, chatId}) {
      storage.transaction(() => {
        if (requireAuthorityState(storage).state === "active") {
          throw new Error("Legacy Binding writes are disabled after canonical cutover.");
        }
        validateBindingName(name);
        if (name === "GADGET") throw new Error("The binding name `GADGET` is reserved.");
        const gadget = requireGadget(adapter, consumerId);
        const existing = gadget.bindings[name];
        if (existing) {
          if (existing.pending && existing.pending.chatId !== chatId) {
            throw new Error(`The binding name "${name}" is already proposed by another chat. ` +
              "Accept or revert that chat's changes first, or choose a different name.");
          }
          throw new Error(`There is already a binding named "${name}".`);
        }
        if (!adapter.hasContract(contractId)) {
          if (adapter.getGadget(contractId)) {
            throw new Error("Gadget-to-gadget bindings are not supported yet.");
          }
          if (adapter.hasGatekeeper(contractId)) {
            throw new Error("Gadgets can only bind installed Contracts, not raw Sources.");
          }
          throw new Error(`No such Contract: ${contractId}`);
        }
        for (const other of adapter.listGadgets()) {
          const placement = Object.entries(other.bindings).find(
            ([, edge]) => edge.target === contractId,
          );
          if (placement) {
            throw new Error(`Contract ${contractId} is already installed as ` +
              `${other.title}.${placement[0]}; create and approve a separate Contract instance ` +
              "for another binding placement.");
          }
        }
        gadget.bindings[name] = {
          target: contractId,
          ...(chatId === undefined ? {} : {pending: {chatId}}),
        };
        adapter.putGadget(gadget);
        appendMigrationDelta(storage, contractId, "bindingAdded");
      });
      adapter.bumpConsumers([consumerId]);
    },
    unbind({consumerId, name, forChatId}) {
      storage.transaction(() => {
        if (requireAuthorityState(storage).state === "active") {
          throw new Error("Legacy Binding writes are disabled after canonical cutover.");
        }
        const gadget = requireGadget(adapter, consumerId);
        const edge = gadget.bindings[name];
        if (!edge || (edge.pending && edge.pending.chatId !== forChatId && forChatId !== undefined)) {
          throw new Error(`No such binding: ${name}`);
        }
        delete gadget.bindings[name];
        adapter.putGadget(gadget);
        appendMigrationDelta(storage, edge.target, "bindingRemoved");
      });
      adapter.bumpConsumers([consumerId]);
    },
    renameBinding({consumerId, oldName, newName}) {
      storage.transaction(() => {
        if (requireAuthorityState(storage).state === "active") {
          throw new Error("Legacy Binding writes are disabled after canonical cutover.");
        }
        const gadget = requireGadget(adapter, consumerId);
        const edge = gadget.bindings[oldName];
        if (!edge) throw new Error(`No such binding: ${oldName}`);
        if (oldName === newName) return;
        validateBindingName(newName);
        if (newName === "GADGET") throw new Error("The binding name `GADGET` is reserved.");
        if (gadget.bindings[newName]) {
          throw new Error(`There is already a binding named "${newName}".`);
        }
        delete gadget.bindings[oldName];
        gadget.bindings[newName] = edge;
        adapter.putGadget(gadget);
        appendMigrationDelta(storage, edge.target, "bindingRenamed");
      });
      adapter.bumpConsumers([consumerId]);
    },
    retractContract(contractId) {
      const consumers = storage.transaction(() => {
        const state = requireAuthorityState(storage);
        if (state.state !== "active") {
          appendMigrationDelta(storage, contractId, "contractRetracted");
        } else {
          const instance = storage.contractInstances.byLegacyWorkpieceId.get(contractId);
          if (instance && instance.lifecycle !== "retracted") {
            const bindings = Array.from(storage.bindings.byInstance.get(instance.id))
              .filter(binding => binding.status !== "retracted");
            let terminalSequence: number | undefined;
            for (const binding of bindings) {
              const generation = binding.generation + 1;
              const sequence = appendAuthorityEvent(storage, {
                type: "bindingRetracted",
                subjectId: binding.id,
                operationId: `legacy-contract-delete:${contractId}`,
                beforeGeneration: binding.generation,
                afterGeneration: generation,
              });
              terminalSequence = sequence;
              storage.bindings.put({
                ...binding,
                status: "retracted",
                generation,
                revision: binding.revision + 1,
              });
              storage.authorityTombstones.put({
                id: issueAuthorityId<"authorityTombstone">(),
                subject: {type: "binding", id: binding.id},
                lineage: binding.predecessorId,
                terminalReason: "legacy-contract-deleted",
                terminalSequence: sequence,
                cleanup: "pending",
              });
            }
            terminalSequence ??= appendAuthorityEvent(storage, {
              type: "contractInstanceRetracted",
              subjectId: instance.id,
              operationId: `legacy-contract-delete:${contractId}`,
              beforeGeneration: instance.generation,
              afterGeneration: instance.generation + 1,
            });
            transitionContractInstance(
              storage,
              instance.id,
              "retracted",
              terminalSequence,
              "legacy-contract-deleted",
            );
          }
        }
        return adapter.retractContract(contractId);
      });
      adapter.bumpConsumers(consumers);
    },
    authorizeLegacyManagerSource({surface, chatId, gatekeeperId}) {
      if (surface !== "managerAgentAuthoring") {
        throw new Error("Legacy Manager Sources are restricted to Manager agent authoring.");
      }
      if (!adapter.hasGatekeeper(gatekeeperId)) {
        throw new Error(`No such legacy Source: ${gatekeeperId}`);
      }
      const access: LegacyManagerSourceAccess = {
        gatekeeperId,
        chatId,
        [legacyManagerSourceAccessBrand]: true,
      };
      issuedLegacyManagerSourceAccess.add(access);
      return access;
    },
    consumeLegacyManagerSourceAccess(access) {
      if (!issuedLegacyManagerSourceAccess.delete(access)) {
        throw new Error("Legacy Manager Source access was forged, reused, or issued before restart.");
      }
      storage.transaction(() => {
        const current = storage.legacyManagerSourceTelemetry.get();
        const nextUse = {
          chatId: access.chatId,
          gatekeeperId: access.gatekeeperId,
          observedAt: Date.now(),
        };
        storage.legacyManagerSourceTelemetry.put({
          totalUses: Math.min(Number.MAX_SAFE_INTEGER, current.totalUses + 1),
          recentUses: [...current.recentUses, nextUse].slice(-LEGACY_MANAGER_SOURCE_SAMPLE_LIMIT),
        });
      });
      return {
        gatekeeperId: access.gatekeeperId,
        chatId: access.chatId,
      };
    },
    queryLegacyManagerSourceTelemetry() {
      const telemetry = storage.legacyManagerSourceTelemetry.get();
      return structuredClone(telemetry);
    },
  };

  return {authority, compatibility};
}
