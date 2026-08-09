import {collection, createTypedStorage} from "@gadgets/typed-storage";
import {
  validateBindingName,
  type BlueprintBindingAnnotation,
  type WorkpieceId,
} from "@gadgets/workshop-shared/api";
import type {
  AuthorityId,
  ArtifactApprovalId,
  ArtifactApprovalRecord,
  ArtifactProposalId,
  ArtifactProposalRecord,
  AuthorityDebtId,
  AuthorityDebtRecord,
  AuthorityLifecycleTombstoneRecord,
  BindingId,
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
  LiveUpstreamAuthorityReference,
  PlacementDecisionReference,
  RuntimeApprovalDecisionId,
  RuntimeApprovalDecisionRecord,
  RuntimeApprovalRequestId,
  RuntimeApprovalRequestRecord,
  SourceId,
  TaskDispatchDecisionId,
  TaskDispatchDecisionRecord,
  RequirementId,
  UpstreamAuthorityReference,
} from "./records";

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
};

type WorkspaceAuthorityEvent = {
  sequence: number;
  type:
    | "authorityModuleInitialized"
    | "artifactProposalRecorded"
    | "artifactApprovalRecorded"
    | "installationDecisionRecorded"
    | "taskDispatchDecisionRecorded"
    | "contractInstancePrepared"
    | "contractInstanceRetracted"
    | "bindingPublished"
    | "bindingSuspended"
    | "bindingRetracted"
    | "runtimeApprovalRequested"
    | "runtimeApprovalDecided"
    | "authorityDebtRecorded"
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

type WorkspaceAuthorityEffect = {
  id: string;
  state: "pending" | "completed";
};

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
      workspaceAuthorityEffects: collection<WorkspaceAuthorityEffect>()({
        primaryKey: "id",
      }),
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
      }),
      taskDispatchDecisions: collection<TaskDispatchDecisionRecord>()({
        primaryKey: "id",
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
        nonUniqueIndexes: {
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

type LiveInstallationDecisionInput = Omit<
  InstallationDecisionRecord,
  | "id"
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
      type: "recordArtifactApproval";
      operationId: string;
      record: LiveArtifactApprovalInput;
    }
  | {
      type: "recordInstallationDecision";
      operationId: string;
      record: LiveInstallationDecisionInput;
    }
  | {
      type: "recordTaskDispatchDecision";
      operationId: string;
      record: Omit<TaskDispatchDecisionRecord, "id" | "decisionSequence">;
    }
  | {
      type: "prepareContractInstance";
      operationId: string;
      record: LiveContractInstanceInput;
    }
  | {
      type: "publishBinding";
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
      type: "suspendBinding" | "retractBinding";
      operationId: string;
      bindingId: BindingId;
      expectedGeneration: number;
      reason: string;
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
  | {type: "contractInstancePrepared"; id: ContractInstanceId; sequence: number}
  | {
      type: "bindingPublished";
      bindingId: BindingId;
      resolutionId: BindingResolutionId;
      generation: number;
      sequence: number;
    }
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
  | {type: "taskDispatchDecision"; id: TaskDispatchDecisionId}
  | {type: "contractInstance"; id: ContractInstanceId}
  | {type: "binding"; id: BindingId}
  | {type: "bindingByConsumerName"; consumerId: ConsumerId; name: string}
  | {type: "bindingResolution"; id: BindingResolutionId}
  | {type: "runtimeApprovalRequest"; id: RuntimeApprovalRequestId}
  | {type: "runtimeApprovalDecision"; id: RuntimeApprovalDecisionId}
  | {type: "authorityDebt"; id: AuthorityDebtId}
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
  | {type: "taskDispatchDecision"; value?: TaskDispatchDecisionRecord}
  | {type: "contractInstance"; value?: ContractInstanceRecord}
  | {type: "binding"; value?: BindingRecord}
  | {type: "bindingByConsumerName"; value?: BindingRecord}
  | {type: "bindingResolution"; value?: BindingResolutionRecord}
  | {type: "runtimeApprovalRequest"; value?: RuntimeApprovalRequestRecord}
  | {type: "runtimeApprovalDecision"; value?: RuntimeApprovalDecisionRecord}
  | {type: "authorityDebt"; value?: AuthorityDebtRecord}
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
    if (effect.state === "pending") pendingEffects++;
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

function requireAuthorityState(storage: AuthorityStorage): WorkspaceAuthorityState {
  const state = storage.workspaceAuthorityState.get();
  if (!state) throw new Error("Workspace Authority is not initialized.");
  return state;
}

function requireActiveAuthority(storage: AuthorityStorage): void {
  if (requireAuthorityState(storage).state !== "active") {
    throw new Error("Canonical Workspace Authority is not active.");
  }
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

function sameAuthorityValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

/** Creates the sole in-process Workspace Authority module over the existing Workspace storage. */
export function createWorkspaceAuthorityModule<
  Gadget extends LegacyGadgetAuthorityRecord = LegacyGadgetAuthorityRecord,
>(
  durableStorage: DurableObjectStorage,
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
): WorkspaceAuthorityModule {
  const storage = makeAuthorityStorage(durableStorage);
  const issuedLegacyManagerSourceAccess = new WeakSet<object>();

  const authority: WorkspaceAuthority = {
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
        case "recordArtifactApproval":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const proposal = validateArtifactApprovalEvidence(storage, command.record);
            let approvalEpoch = 1;
            while (storage.artifactApprovals.byArtifactEpoch.get(
              compositeKey(command.record.artifactHash, approvalEpoch),
            )) approvalEpoch++;
            const id = issueAuthorityId<"artifactApproval">();
            const sequence = appendAuthorityEvent(storage, {
              type: "artifactApprovalRecorded",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.artifactApprovals.put({
              ...structuredClone(command.record),
              id,
              approvalEpoch,
              decisionSequence: sequence,
              revision: 1,
            });
            storage.artifactProposals.put({
              ...proposal,
              state: command.record.decision === "approved" ? "accepted" : "rejected",
              revision: proposal.revision + 1,
            });
            return {type: "artifactApprovalRecorded", id, approvalEpoch, sequence};
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
            const id = issueAuthorityId<"installationDecision">();
            const sequence = appendAuthorityEvent(storage, {
              type: "installationDecisionRecorded",
              subjectId: id,
              operationId: command.operationId,
            });
            storage.installationDecisions.put({
              ...structuredClone(command.record),
              id,
              decisionSequence: sequence,
            });
            return {type: "installationDecisionRecorded", id, sequence};
          });
        case "recordTaskDispatchDecision":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
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
                  requirement.taskTemplateVersion !== command.record.taskTemplateVersion)) {
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
              decisionSequence: sequence,
            });
            return {type: "taskDispatchDecisionRecorded", id, sequence};
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
        case "publishBinding":
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
            const predecessor = storage.bindings.currentByConsumerName.get(activeKey);
            const actualGeneration = predecessor?.generation ?? 0;
            if (actualGeneration !== command.expectedBindingGeneration) {
              throw new Error(`Stale Binding generation: expected ` +
                `${command.expectedBindingGeneration}, current ${actualGeneration}.`);
            }
            const bindingId = issueAuthorityId<"binding">();
            const resolutionId = issueAuthorityId<"bindingResolution">();
            const generation = actualGeneration + 1;
            const sequence = appendAuthorityEvent(storage, {
              type: "bindingPublished",
              subjectId: bindingId,
              operationId: command.operationId,
              beforeGeneration: actualGeneration,
              afterGeneration: generation,
            });
            if (predecessor) {
              storage.bindings.put({
                ...predecessor,
                status: "retracted",
                generation,
                revision: predecessor.revision + 1,
              });
              transitionContractInstance(
                storage,
                predecessor.contractInstanceId,
                "retracted",
                sequence,
                "binding-replaced",
              );
            }
            const resolution: BindingResolutionRecord = {
              id: resolutionId,
              consumer: structuredClone(command.consumer),
              requirement: structuredClone(command.requirement),
              upstreamAuthority: structuredClone(instance.upstreamAuthority),
              verification: structuredClone(command.verification),
              artifactApprovalId: instance.artifactApprovalId,
              artifactApprovalEpoch: requireActiveApproval(storage, instance.artifactApprovalId)
                .approvalEpoch,
              placementDecision: structuredClone(instance.placementDecision),
              contractInstanceId: instance.id,
              bindingId,
              sharedState: structuredClone(instance.sharedState),
              expectedBindingGeneration: command.expectedBindingGeneration,
              evaluatorPolicyHash: command.evaluatorPolicyHash,
              createdSequence: sequence,
            };
            const binding: BindingRecord = {
              id: bindingId,
              consumer: structuredClone(command.consumer),
              name: command.name,
              requirement: structuredClone(command.requirement),
              contractInstanceId: instance.id,
              resolutionId,
              status: "active",
              generation,
              revision: 1,
              installedSequence: sequence,
              ...(predecessor ? {predecessorId: predecessor.id} : {}),
            };
            storage.bindingResolutions.put(resolution);
            storage.contractInstances.put({...instance, lifecycle: "ready", revision: instance.revision + 1});
            storage.bindings.put(binding);
            return {type: "bindingPublished", bindingId, resolutionId, generation, sequence};
          });
        case "suspendBinding":
        case "retractBinding":
          return storage.transaction(() => {
            requireActiveAuthority(storage);
            const current = storage.bindings.get(command.bindingId);
            if (!current || current.status === "retracted") {
              throw new Error(`Binding is not mutable: ${command.bindingId}`);
            }
            if (current.generation !== command.expectedGeneration) {
              throw new Error(`Stale Binding generation: expected ${command.expectedGeneration}, ` +
                `current ${current.generation}.`);
            }
            const generation = current.generation + 1;
            const retracted = command.type === "retractBinding";
            const eventType = retracted ? "bindingRetracted" : "bindingSuspended";
            const sequence = appendAuthorityEvent(storage, {
              type: eventType,
              subjectId: current.id,
              operationId: command.operationId,
              beforeGeneration: current.generation,
              afterGeneration: generation,
            });
            storage.bindings.put({
              ...current,
              status: retracted ? "retracted" : "suspended",
              generation,
              revision: current.revision + 1,
            });
            transitionContractInstance(
              storage,
              current.contractInstanceId,
              retracted ? "retracted" : "suspended",
              sequence,
              command.reason,
            );
            if (retracted) {
              storage.authorityTombstones.put({
                id: issueAuthorityId<"authorityTombstone">(),
                subject: {type: "binding", id: current.id},
                lineage: current.predecessorId,
                terminalReason: command.reason,
                terminalSequence: sequence,
                cleanup: "pending",
              });
            }
            return {
              type: retracted ? "bindingRetracted" : "bindingSuspended",
              generation,
              sequence,
            };
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
            if (command.record.bindingId && !storage.bindings.get(command.record.bindingId)) {
              throw new Error(`No such Binding: ${command.record.bindingId}`);
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
        case "taskDispatchDecision":
          return {
            type: "taskDispatchDecision",
            value: requireAuthorityState(storage).state === "active"
              ? storage.taskDispatchDecisions.get(query.id)
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
        case "bindingResolution":
          return {
            type: "bindingResolution",
            value: requireAuthorityState(storage).state === "active"
              ? storage.bindingResolutions.get(query.id)
              : undefined,
          };
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
      return {attemptedEffects: status(storage).pendingEffects};
    },
  };

  const compatibility: LegacyWorkspaceAuthorityCompatibility = {
    queryVisibleBindings({consumerId, forChatId}) {
      const gadget = requireGadget(adapter, consumerId);
      if (requireAuthorityState(storage).state !== "active") {
        return visibleBindings(gadget, forChatId);
      }
      const canonicalConsumerId = findMappedLegacyIdentity(storage, "consumer", consumerId);
      if (!canonicalConsumerId) return [];
      const projected: [string, LegacyGadgetBindingRecord][] = [];
      for (const binding of storage.bindings.byConsumer.get(canonicalConsumerId)) {
        if (binding.status !== "active") continue;
        const instance = storage.contractInstances.get(binding.contractInstanceId);
        if (instance?.legacyWorkpieceId === undefined) continue;
        const metadata = gadget.bindings[binding.name];
        projected.push([
          binding.name,
          {
            target: instance.legacyWorkpieceId,
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
