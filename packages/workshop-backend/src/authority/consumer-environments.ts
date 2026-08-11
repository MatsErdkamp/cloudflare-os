import {collection, createTypedStorage} from "@gadgets/typed-storage";

const DEVELOPMENT_LEASE_MS = 15 * 60 * 1_000;
const WORKLOAD_ATTACHMENT_MS = 15 * 60 * 1_000;

type BindingSetReference = Readonly<{id: string; version: number}>;

/** One capability-free reference to a canonical Binding in an immutable Consumer environment. */
export interface CanonicalEnvironmentBinding {
  /** Published Binding name. */
  readonly name: string;
  /** Whether absence blocks the whole Consumer environment. */
  readonly required: boolean;
  /** Canonical Binding ID. */
  readonly bindingId: string;
  /** Published Binding generation. */
  readonly bindingGeneration: number;
  /** Canonical Contract Instance ID selected by the Binding. */
  readonly contractInstanceId: string;
  /** Contract Instance generation acknowledged by its enforcement endpoint. */
  readonly contractInstanceGeneration: number;
  /** Exact approved Artifact used by the Contract Instance. */
  readonly artifactApprovalId: string;
  /** Active Artifact Approval epoch cited by the Resolution. */
  readonly artifactApprovalEpoch: number;
  /** Exact approved public TypeScript declarations used for generated types. */
  readonly publicTypes: string;
}

/** Capability-free canonical Binding snapshot read from Workspace Authority. */
export interface CanonicalBindingEnvironment {
  /** Whether every required Requirement has an active acknowledged Binding. */
  readonly ready: boolean;
  /** Stored Consumer environment generation. */
  readonly generation: number;
  /** Exact immutable Binding Set assigned to the Consumer. */
  readonly bindingSet: BindingSetReference;
  /** Exact published Bindings, in stable name order. */
  readonly bindings: readonly CanonicalEnvironmentBinding[];
}

type DevelopmentGrantRecord = Readonly<{
  id: string;
  principalId: string;
  generation: number;
  projectId: string;
  environmentId: string;
  bindingSet: BindingSetReference;
  consumerId: string;
  consumerGeneration: number;
  lifecycle: "active" | "revoked";
}>;

type DevelopmentSessionRecord = Readonly<{
  id: string;
  startOperationId: string;
  principalId: string;
  grantId: string;
  grantGeneration: number;
  projectId: string;
  environmentId: string;
  bindingSet: BindingSetReference;
  consumerId: string;
  consumerGeneration: number;
  leaseGeneration: number;
  issuedAt: number;
  expiresAt: number;
  environmentGeneration: number;
  lifecycle: "active" | "disconnected" | "expired";
  lastOperationId: string;
}>;

type WorkloadRecord = Readonly<{
  id: string;
  consumerId: string;
  consumerGeneration: number;
  projectId: string;
  environmentId: string;
  bindingSet: BindingSetReference;
  generation: number;
  lifecycle: "active" | "suspended" | "retired";
  agentService?: Readonly<{profileId: string; role: string}>;
}>;

type WorkloadRegistrationRecord = Readonly<{
  id: string;
  workloadId: string;
  adapterId: "cloudflare-service-binding.v1";
  issuer: string;
  credentialSubject: string;
  credentialGeneration: number;
  generation: number;
  lifecycle: "active" | "suspended" | "revoked";
  nextCredential?: Readonly<{
    subject: string;
    generation: number;
    validUntil: number;
  }>;
}>;

type EnvironmentSnapshot = Readonly<{
  kind: "development" | "workload";
  ownerId: string;
  consumerId: string;
  consumerGeneration: number;
  environmentGeneration: number;
  bindingSet: BindingSetReference;
  bindings: readonly CanonicalEnvironmentBinding[];
  deadline: number;
  leaseGeneration?: number;
  registrationGeneration?: number;
  registrationId?: string;
  workloadGeneration?: number;
}>;

type WorkloadAttachment = Readonly<{
  registrationId: string;
  registrationGeneration: number;
  workloadId: string;
  workloadGeneration: number;
  consumerId: string;
  consumerGeneration: number;
  environmentGeneration: number;
  expiresAt: number;
}>;

type ConsumerEnvironmentHead = Readonly<{
  consumerId: string;
  generation: number;
  snapshotDigest: string;
}>;

type ConsumerLifecycleEvent = Readonly<{
  type: "developmentGrantChanged" | "developmentSessionChanged" |
    "workloadChanged" | "workloadRegistrationChanged";
  subjectId: string;
  operationId?: string;
  beforeGeneration?: number;
  afterGeneration?: number;
}>;

function sameBindingSet(left: BindingSetReference, right: BindingSetReference): boolean {
  return left.id === right.id && left.version === right.version;
}

function makeConsumerEnvironmentStorage(storage: DurableObjectStorage) {
  return createTypedStorage(storage, {
    collections: {
      developmentGrants: collection<DevelopmentGrantRecord>()({primaryKey: "id"}),
      developmentSessions: collection<DevelopmentSessionRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byStartOperation(record: DevelopmentSessionRecord) {
            return record.startOperationId;
          },
        },
        nonUniqueIndexes: {
          byExpiry(record: DevelopmentSessionRecord) {
            return record.lifecycle === "active" ? record.expiresAt : null;
          },
        },
      }),
      workloads: collection<WorkloadRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byConsumer(record: WorkloadRecord) {
            return record.consumerId;
          },
          byAgentService(record: WorkloadRecord) {
            return record.agentService?.profileId ?? null;
          },
        },
      }),
      workloadRegistrations: collection<WorkloadRegistrationRecord>()({
        primaryKey: "id",
        uniqueIndexes: {
          byWorkload(record: WorkloadRegistrationRecord) {
            return record.lifecycle === "revoked" ? null : record.workloadId;
          },
          byCredential(record: WorkloadRegistrationRecord) {
            return record.lifecycle === "active"
              ? `${record.adapterId}\0${record.issuer}\0${record.credentialSubject}`
              : null;
          },
        },
      }),
      consumerEnvironmentHeads: collection<ConsumerEnvironmentHead>()({primaryKey: "consumerId"}),
    },
  });
}

/** Workspace-owned lifecycle module for leased Development and authenticated Workload Consumers. */
export class ConsumerEnvironmentAuthority {
  readonly #storage: ReturnType<typeof makeConsumerEnvironmentStorage>;
  readonly #readCanonicalEnvironment: (consumerId: string) => CanonicalBindingEnvironment;
  readonly #recordLifecycleEvent: (event: ConsumerLifecycleEvent) => void;

  /** Creates the Consumer lifecycle submodule over the Workspace aggregate's durable storage. */
  constructor(
    storage: DurableObjectStorage,
    readCanonicalEnvironment: (consumerId: string) => CanonicalBindingEnvironment,
    recordLifecycleEvent: (event: ConsumerLifecycleEvent) => void = () => {},
  ) {
    this.#storage = makeConsumerEnvironmentStorage(storage);
    this.#readCanonicalEnvironment = readCanonicalEnvironment;
    this.#recordLifecycleEvent = recordLifecycleEvent;
  }

  /** Stores one already-reviewed Development Session Grant and exact placement assignment. */
  putDevelopmentGrant(record: DevelopmentGrantRecord): void {
    this.#storage.transaction(() => {
      this.#storage.developmentGrants.put(structuredClone(record));
      this.#recordLifecycleEvent({
        type: "developmentGrantChanged",
        subjectId: record.id,
        afterGeneration: record.generation,
      });
    });
  }

  /** Revokes a Grant generation so every Session attachment immediately fails closed. */
  revokeDevelopmentGrant(grantId: string, expectedGeneration: number): void {
    this.#storage.transaction(() => {
      const grant = this.#storage.developmentGrants.get(grantId);
      if (!grant || grant.generation !== expectedGeneration) {
        throw new Error("Development Session Grant generation is stale.");
      }
      this.#storage.developmentGrants.put({
        ...grant,
        generation: grant.generation + 1,
        lifecycle: "revoked",
      });
      this.#recordLifecycleEvent({
        type: "developmentGrantChanged",
        subjectId: grant.id,
        beforeGeneration: grant.generation,
        afterGeneration: grant.generation + 1,
      });
    });
  }

  /** Starts or exactly replays one 15-minute Development Session lease. */
  startDevelopmentSession(input: Readonly<{
    operationId: string;
    principalId: string;
    grantId: string;
    expectedGrantGeneration: number;
    expectedBindingSet: BindingSetReference;
  }>): DevelopmentSessionRecord {
    return this.#storage.transaction(() => {
      const replay = this.#storage.developmentSessions.byStartOperation.get(input.operationId);
      if (replay) {
        if (replay.principalId !== input.principalId || replay.grantId !== input.grantId ||
            replay.grantGeneration !== input.expectedGrantGeneration ||
            !sameBindingSet(replay.bindingSet, input.expectedBindingSet)) {
          throw new Error("Development Session operation was reused for another request.");
        }
        return replay;
      }
      const grant = this.#storage.developmentGrants.get(input.grantId);
      if (!grant || grant.lifecycle !== "active" || grant.principalId !== input.principalId ||
          grant.generation !== input.expectedGrantGeneration ||
          !sameBindingSet(grant.bindingSet, input.expectedBindingSet)) {
        throw new Error("Development Session grant is unavailable or stale.");
      }
      const canonical = this.#requireAssignedEnvironment(grant.consumerId, grant.bindingSet);
      const now = Date.now();
      const session: DevelopmentSessionRecord = {
        id: crypto.randomUUID(),
        startOperationId: input.operationId,
        principalId: grant.principalId,
        grantId: grant.id,
        grantGeneration: grant.generation,
        projectId: grant.projectId,
        environmentId: grant.environmentId,
        bindingSet: structuredClone(grant.bindingSet),
        consumerId: grant.consumerId,
        consumerGeneration: grant.consumerGeneration,
        leaseGeneration: 1,
        issuedAt: now,
        expiresAt: now + DEVELOPMENT_LEASE_MS,
        environmentGeneration: canonical.generation,
        lifecycle: "active",
        lastOperationId: input.operationId,
      };
      this.#storage.developmentSessions.put(session);
      this.#recordLifecycleEvent({
        type: "developmentSessionChanged",
        subjectId: session.id,
        operationId: input.operationId,
        afterGeneration: session.consumerGeneration,
      });
      return session;
    });
  }

  /** Resumes the same live Session identity without treating transport loss as durable state. */
  resumeDevelopmentSession(input: Readonly<{
    sessionId: string;
    principalId: string;
    expectedConsumerGeneration: number;
  }>): DevelopmentSessionRecord {
    const session = this.#requireLiveSession(input.sessionId, input.principalId);
    if (session.consumerGeneration !== input.expectedConsumerGeneration) {
      throw new Error("Development Session generation is stale.");
    }
    this.#requireLiveGrant(session);
    this.#requireAssignedEnvironment(session.consumerId, session.bindingSet);
    return session;
  }

  /** Renews the lease without changing its authority assignment or selecting another Source. */
  renewDevelopmentSession(input: Readonly<{
    operationId: string;
    sessionId: string;
    principalId: string;
    expectedConsumerGeneration: number;
    expectedLeaseGeneration: number;
  }>): DevelopmentSessionRecord {
    return this.#storage.transaction(() => {
      const session = this.#requireLiveSession(input.sessionId, input.principalId);
      if (session.lastOperationId === input.operationId) return session;
      if (session.consumerGeneration !== input.expectedConsumerGeneration ||
          session.leaseGeneration !== input.expectedLeaseGeneration) {
        throw new Error("Development Session lease generation is stale.");
      }
      this.#requireLiveGrant(session);
      const canonical = this.#requireAssignedEnvironment(session.consumerId, session.bindingSet);
      const renewed = {
        ...session,
        leaseGeneration: session.leaseGeneration + 1,
        expiresAt: Date.now() + DEVELOPMENT_LEASE_MS,
        environmentGeneration: canonical.generation,
        lastOperationId: input.operationId,
      };
      this.#storage.developmentSessions.put(renewed);
      this.#recordLifecycleEvent({
        type: "developmentSessionChanged",
        subjectId: session.id,
        operationId: input.operationId,
        beforeGeneration: session.leaseGeneration,
        afterGeneration: renewed.leaseGeneration,
      });
      return renewed;
    });
  }

  /** Opens one immutable, capability-free Development environment descriptor. */
  openDevelopmentEnvironment(
    sessionId: string,
    principalId: string,
    expectedEnvironmentGeneration: number,
  ): EnvironmentSnapshot {
    const session = this.#requireLiveSession(sessionId, principalId);
    this.#requireLiveGrant(session);
    const canonical = this.#requireReadyEnvironment(session.consumerId, session.bindingSet);
    if (canonical.generation !== expectedEnvironmentGeneration ||
        session.environmentGeneration !== expectedEnvironmentGeneration) {
      throw new Error("Development environment generation is stale.");
    }
    return {
      kind: "development",
      ownerId: session.id,
      consumerId: session.consumerId,
      consumerGeneration: session.consumerGeneration,
      environmentGeneration: canonical.generation,
      bindingSet: structuredClone(session.bindingSet),
      bindings: structuredClone(canonical.bindings),
      deadline: session.expiresAt,
      leaseGeneration: session.leaseGeneration,
    };
  }

  /** Reads bounded Session status without delivering any Contract capability. */
  getDevelopmentSessionStatus(sessionId: string, principalId: string): Readonly<{
    id: string;
    consumerGeneration: number;
    leaseGeneration: number;
    expiresAt: number;
    environmentGeneration: number;
    bindingSet: BindingSetReference;
    ready: boolean;
    lifecycle: "active" | "disconnected" | "expired";
  }> {
    const session = this.#storage.developmentSessions.get(sessionId);
    if (!session || session.principalId !== principalId) {
      throw new Error("Development Session unavailable.");
    }
    const expired = session.expiresAt <= Date.now();
    const canonical = this.#observeCanonicalEnvironment(session.consumerId);
    return {
      id: session.id,
      consumerGeneration: session.consumerGeneration,
      leaseGeneration: session.leaseGeneration,
      expiresAt: session.expiresAt,
      environmentGeneration: session.environmentGeneration,
      bindingSet: structuredClone(session.bindingSet),
      ready: session.lifecycle === "active" && !expired && canonical.ready &&
        canonical.generation === session.environmentGeneration &&
        sameBindingSet(canonical.bindingSet, session.bindingSet),
      lifecycle: session.lifecycle === "disconnected"
        ? "disconnected"
        : expired ? "expired" : "active",
    };
  }

  /** Returns the exact Consumer identity needed by the host's enforcement-first disconnect. */
  getDevelopmentConsumer(sessionId: string, principalId: string): Readonly<{
    consumerId: string;
    consumerGeneration: number;
  }> {
    const session = this.#storage.developmentSessions.get(sessionId);
    if (!session || session.principalId !== principalId || session.lifecycle !== "active") {
      throw new Error("Development Session unavailable.");
    }
    return {
      consumerId: session.consumerId,
      consumerGeneration: session.consumerGeneration,
    };
  }

  /** Returns the earliest active lease deadline for the shared workspace alarm. */
  nextDevelopmentExpiryAt(): number | undefined {
    return [...this.#storage.developmentSessions.byExpiry.list({limit: 1})][0]?.expiresAt;
  }

  /** Returns a bounded batch of active Sessions whose persisted lease deadline has passed. */
  getDueDevelopmentSessions(now: number): readonly Readonly<{
    sessionId: string;
    principalId: string;
    consumerId: string;
    consumerGeneration: number;
  }>[] {
    const end = now < Number.MAX_SAFE_INTEGER ? now + 1 : now;
    return [...this.#storage.developmentSessions.byExpiry.list({end, limit: 16})].map(session => ({
      sessionId: session.id,
      principalId: session.principalId,
      consumerId: session.consumerId,
      consumerGeneration: session.consumerGeneration,
    }));
  }

  /** Commits the terminal Session state after its canonical Bindings were invalidated. */
  expireDevelopmentSession(input: Readonly<{
    operationId: string;
    sessionId: string;
    expectedConsumerGeneration: number;
  }>): void {
    this.#storage.transaction(() => {
      const session = this.#storage.developmentSessions.get(input.sessionId);
      if (!session || session.lifecycle === "expired") return;
      if (session.lifecycle !== "active" || session.expiresAt > Date.now() ||
          session.consumerGeneration !== input.expectedConsumerGeneration) return;
      this.#storage.developmentSessions.put({
        ...session,
        consumerGeneration: session.consumerGeneration + 1,
        lifecycle: "expired",
        lastOperationId: input.operationId,
      });
      this.#recordLifecycleEvent({
        type: "developmentSessionChanged",
        subjectId: session.id,
        operationId: input.operationId,
        beforeGeneration: session.consumerGeneration,
        afterGeneration: session.consumerGeneration + 1,
      });
    });
  }

  /** Immediately invalidates all Session snapshots; endpoint cleanup may reconcile afterward. */
  disconnectDevelopmentSession(input: Readonly<{
    operationId: string;
    sessionId: string;
    principalId: string;
    expectedConsumerGeneration: number;
  }>): void {
    this.#storage.transaction(() => {
      const session = this.#storage.developmentSessions.get(input.sessionId);
      if (!session || session.principalId !== input.principalId) {
        throw new Error("Development Session unavailable.");
      }
      if (session.lifecycle === "disconnected") return;
      if (session.consumerGeneration !== input.expectedConsumerGeneration) {
        throw new Error("Development Session generation is stale.");
      }
      this.#storage.developmentSessions.put({
        ...session,
        consumerGeneration: session.consumerGeneration + 1,
        lifecycle: "disconnected",
        lastOperationId: input.operationId,
      });
      this.#recordLifecycleEvent({
        type: "developmentSessionChanged",
        subjectId: session.id,
        operationId: input.operationId,
        beforeGeneration: session.consumerGeneration,
        afterGeneration: session.consumerGeneration + 1,
      });
    });
  }

  /** Stores one stable Workload and its optional one-to-one Agent Service role/profile. */
  putWorkload(record: WorkloadRecord): void {
    this.#storage.transaction(() => {
      this.#storage.workloads.put(structuredClone(record));
      this.#recordLifecycleEvent({
        type: "workloadChanged",
        subjectId: record.id,
        afterGeneration: record.generation,
      });
    });
  }

  /** Stores one same-account Workload Registration chosen by Workspace Authority. */
  putWorkloadRegistration(record: WorkloadRegistrationRecord): void {
    this.#storage.transaction(() => {
      this.#storage.workloadRegistrations.put(structuredClone(record));
      this.#recordLifecycleEvent({
        type: "workloadRegistrationChanged",
        subjectId: record.id,
        afterGeneration: record.generation,
      });
    });
  }

  /** Suspends or terminally retires a Workload and invalidates every attachment generation. */
  transitionWorkload(
    workloadId: string,
    expectedGeneration: number,
    lifecycle: "suspended" | "retired",
  ): void {
    this.#storage.transaction(() => {
      const workload = this.#storage.workloads.get(workloadId);
      if (!workload || workload.generation !== expectedGeneration) {
        throw new Error("Workload generation is stale.");
      }
      this.#storage.workloads.put({
        ...workload,
        generation: workload.generation + 1,
        consumerGeneration: workload.consumerGeneration + 1,
        lifecycle,
      });
      this.#recordLifecycleEvent({
        type: "workloadChanged",
        subjectId: workload.id,
        beforeGeneration: workload.generation,
        afterGeneration: workload.generation + 1,
      });
    });
  }

  /** Authenticates platform evidence and returns a transient, bounded attachment snapshot. */
  attachWorkload(input: Readonly<{
    registrationId: string;
    evidence: Readonly<{
      adapterId: "cloudflare-service-binding.v1";
      issuer: string;
      subject: string;
      credentialGeneration: number;
      authenticatedAt: number;
      expiresAt: number;
      auditFingerprint: string;
    }>;
  }>): WorkloadAttachment {
    const registration = this.#storage.workloadRegistrations.get(input.registrationId);
    const evidence = input.evidence;
    const currentCredential = registration?.credentialSubject === evidence.subject &&
      registration.credentialGeneration === evidence.credentialGeneration;
    const nextCredential = registration?.nextCredential?.subject === evidence.subject &&
      registration.nextCredential.generation === evidence.credentialGeneration &&
      registration.nextCredential.validUntil > Date.now();
    if (!registration || registration.lifecycle !== "active" ||
        registration.adapterId !== evidence.adapterId ||
        registration.issuer !== evidence.issuer ||
        (!currentCredential && !nextCredential) ||
        evidence.authenticatedAt > Date.now() || evidence.expiresAt <= Date.now()) {
      throw new Error("Workload attachment denied.");
    }
    const workload = this.#storage.workloads.get(registration.workloadId);
    if (!workload || workload.lifecycle !== "active") {
      throw new Error("Workload attachment denied.");
    }
    const canonical = this.#requireReadyEnvironment(workload.consumerId, workload.bindingSet);
    return {
      registrationId: registration.id,
      registrationGeneration: registration.generation,
      workloadId: workload.id,
      workloadGeneration: workload.generation,
      consumerId: workload.consumerId,
      consumerGeneration: workload.consumerGeneration,
      environmentGeneration: canonical.generation,
      expiresAt: Math.min(
        evidence.expiresAt,
        Date.now() + WORKLOAD_ATTACHMENT_MS,
        nextCredential ? registration.nextCredential!.validUntil : Number.MAX_SAFE_INTEGER,
      ),
    };
  }

  /** Opens one immutable, capability-free Workload environment descriptor. */
  openWorkloadEnvironment(
    attachment: WorkloadAttachment,
    expectedEnvironmentGeneration: number,
  ): EnvironmentSnapshot {
    if (attachment.expiresAt <= Date.now()) throw new Error("Workload attachment expired.");
    const registration = this.#storage.workloadRegistrations.get(attachment.registrationId);
    const workload = this.#storage.workloads.get(attachment.workloadId);
    if (!registration || registration.lifecycle !== "active" ||
        registration.generation !== attachment.registrationGeneration ||
        !workload || workload.lifecycle !== "active" ||
        workload.generation !== attachment.workloadGeneration ||
        workload.consumerGeneration !== attachment.consumerGeneration) {
      throw new Error("Workload attachment generation is stale.");
    }
    const canonical = this.#requireReadyEnvironment(workload.consumerId, workload.bindingSet);
    if (canonical.generation !== expectedEnvironmentGeneration ||
        attachment.environmentGeneration !== expectedEnvironmentGeneration) {
      throw new Error("Workload environment generation is stale.");
    }
    return {
      kind: "workload",
      ownerId: workload.id,
      consumerId: workload.consumerId,
      consumerGeneration: workload.consumerGeneration,
      environmentGeneration: canonical.generation,
      bindingSet: structuredClone(workload.bindingSet),
      bindings: structuredClone(canonical.bindings),
      deadline: attachment.expiresAt,
      registrationId: registration.id,
      registrationGeneration: registration.generation,
      workloadGeneration: workload.generation,
    };
  }

  /** Reads bounded attachment status while keeping Registration and Source details private. */
  getWorkloadStatus(attachment: WorkloadAttachment): Readonly<{
    workloadId: string;
    workloadGeneration: number;
    registrationGeneration: number;
    environmentGeneration: number;
    expiresAt: number;
    ready: boolean;
  }> {
    const workload = this.#storage.workloads.get(attachment.workloadId);
    const registration = this.#storage.workloadRegistrations.get(attachment.registrationId);
    const canonical = this.#observeCanonicalEnvironment(attachment.consumerId);
    const ready = attachment.expiresAt > Date.now() && workload?.lifecycle === "active" &&
      workload.generation === attachment.workloadGeneration &&
      workload.consumerGeneration === attachment.consumerGeneration &&
      registration?.lifecycle === "active" &&
      registration.generation === attachment.registrationGeneration &&
      canonical.ready && canonical.generation === attachment.environmentGeneration &&
      sameBindingSet(canonical.bindingSet, workload.bindingSet);
    return {
      workloadId: attachment.workloadId,
      workloadGeneration: attachment.workloadGeneration,
      registrationGeneration: attachment.registrationGeneration,
      environmentGeneration: attachment.environmentGeneration,
      expiresAt: attachment.expiresAt,
      ready,
    };
  }

  /** Returns the exact stable Consumer identity for suspension or terminal retirement. */
  getWorkloadConsumer(workloadId: string): Readonly<{
    consumerId: string;
    consumerGeneration: number;
    workloadGeneration: number;
    lifecycle: WorkloadRecord["lifecycle"];
  }> {
    const workload = this.#storage.workloads.get(workloadId);
    if (!workload) throw new Error("Workload unavailable.");
    return {
      consumerId: workload.consumerId,
      consumerGeneration: workload.consumerGeneration,
      workloadGeneration: workload.generation,
      lifecycle: workload.lifecycle,
    };
  }

  /** Prepares a bounded create-before-destroy credential overlap. */
  rotateWorkloadCredential(input: Readonly<{
    operationId: string;
    registrationId: string;
    expectedGeneration: number;
    credentialSubject: string;
    credentialGeneration: number;
  }>): WorkloadRegistrationRecord {
    return this.#storage.transaction(() => {
      const registration = this.#storage.workloadRegistrations.get(input.registrationId);
      if (!registration || registration.lifecycle !== "active" ||
          registration.generation !== input.expectedGeneration) {
        throw new Error("Workload Registration generation is stale.");
      }
      if (registration.nextCredential) {
        if (registration.nextCredential.subject !== input.credentialSubject ||
            registration.nextCredential.generation !== input.credentialGeneration) {
          throw new Error("Workload credential rotation is already pending.");
        }
        return registration;
      }
      const credentialKey = `${registration.adapterId}\0${registration.issuer}\0` +
        input.credentialSubject;
      const conflict = this.#storage.workloadRegistrations.byCredential.get(credentialKey) ??
        [...this.#storage.workloadRegistrations.list()].find(candidate =>
          candidate.nextCredential?.subject === input.credentialSubject &&
          candidate.adapterId === registration.adapterId && candidate.issuer === registration.issuer);
      if (conflict && conflict.id !== registration.id) {
        throw new Error("Workload credential subject is already registered.");
      }
      const rotated = {
        ...registration,
        nextCredential: {
          subject: input.credentialSubject,
          generation: input.credentialGeneration,
          validUntil: Date.now() + 15 * 60 * 1_000,
        },
      };
      this.#storage.workloadRegistrations.put(rotated);
      this.#recordLifecycleEvent({
        type: "workloadRegistrationChanged",
        subjectId: registration.id,
        operationId: input.operationId,
        beforeGeneration: registration.generation,
        afterGeneration: rotated.generation,
      });
      return rotated;
    });
  }

  /** Finalizes the prepared credential and invalidates every prior Registration snapshot. */
  finalizeWorkloadCredentialRotation(input: Readonly<{
    operationId: string;
    registrationId: string;
    expectedGeneration: number;
    expectedCredentialGeneration: number;
  }>): WorkloadRegistrationRecord {
    return this.#storage.transaction(() => {
      const registration = this.#storage.workloadRegistrations.get(input.registrationId);
      const next = registration?.nextCredential;
      if (!registration || registration.lifecycle !== "active" ||
          registration.generation !== input.expectedGeneration || !next ||
          next.generation !== input.expectedCredentialGeneration ||
          next.validUntil <= Date.now()) {
        throw new Error("Workload credential rotation is unavailable or stale.");
      }
      const finalized: WorkloadRegistrationRecord = {
        ...registration,
        credentialSubject: next.subject,
        credentialGeneration: next.generation,
        generation: registration.generation + 1,
        nextCredential: undefined,
      };
      this.#storage.workloadRegistrations.put(finalized);
      this.#recordLifecycleEvent({
        type: "workloadRegistrationChanged",
        subjectId: registration.id,
        operationId: input.operationId,
        beforeGeneration: registration.generation,
        afterGeneration: finalized.generation,
      });
      return finalized;
    });
  }

  /** Checks every cited generation before any Contract capability is delivered or invoked. */
  validateEnvironmentSnapshot(snapshot: EnvironmentSnapshot): boolean {
    if (snapshot.deadline <= Date.now()) return false;
    const canonical = this.#observeCanonicalEnvironment(snapshot.consumerId);
    if (!canonical.ready || canonical.generation !== snapshot.environmentGeneration ||
        !sameBindingSet(canonical.bindingSet, snapshot.bindingSet) ||
        JSON.stringify(canonical.bindings) !== JSON.stringify(snapshot.bindings)) return false;
    if (snapshot.kind === "development") {
      const session = this.#storage.developmentSessions.get(snapshot.ownerId);
      if (!session || session.lifecycle !== "active" || session.expiresAt !== snapshot.deadline ||
          session.consumerGeneration !== snapshot.consumerGeneration ||
          session.leaseGeneration !== snapshot.leaseGeneration) return false;
      const grant = this.#storage.developmentGrants.get(session.grantId);
      return grant?.lifecycle === "active" && grant.generation === session.grantGeneration;
    }
    const workload = this.#storage.workloads.get(snapshot.ownerId);
    const registration = snapshot.registrationId
      ? this.#storage.workloadRegistrations.get(snapshot.registrationId)
      : undefined;
    return workload?.lifecycle === "active" &&
      workload.generation === snapshot.workloadGeneration &&
      workload.consumerGeneration === snapshot.consumerGeneration &&
      registration?.lifecycle === "active" &&
      registration.workloadId === workload.id &&
      registration.generation === snapshot.registrationGeneration;
  }

  #requireLiveSession(sessionId: string, principalId: string): DevelopmentSessionRecord {
    const session = this.#storage.developmentSessions.get(sessionId);
    if (!session || session.principalId !== principalId || session.lifecycle !== "active") {
      throw new Error("Development Session unavailable.");
    }
    if (session.expiresAt <= Date.now()) throw new Error("Development Session expired.");
    return session;
  }

  #requireLiveGrant(session: DevelopmentSessionRecord): DevelopmentGrantRecord {
    const grant = this.#storage.developmentGrants.get(session.grantId);
    if (!grant || grant.lifecycle !== "active" || grant.generation !== session.grantGeneration ||
        grant.principalId !== session.principalId ||
        grant.consumerGeneration !== session.consumerGeneration ||
        !sameBindingSet(grant.bindingSet, session.bindingSet)) {
      throw new Error("Development Session grant is unavailable or stale.");
    }
    return grant;
  }

  #requireReadyEnvironment(
    consumerId: string,
    bindingSet: BindingSetReference,
  ): CanonicalBindingEnvironment {
    const canonical = this.#observeCanonicalEnvironment(consumerId);
    if (!canonical.ready || !sameBindingSet(canonical.bindingSet, bindingSet)) {
      throw new Error("Canonical Consumer environment is not ready.");
    }
    const names = canonical.bindings.map(binding => binding.name);
    if (new Set(names).size !== names.length || names.some((name, index) =>
      index > 0 && names[index - 1]! >= name)) {
      throw new Error("Canonical Consumer environment is not deterministically ordered.");
    }
    return canonical;
  }

  #requireAssignedEnvironment(
    consumerId: string,
    bindingSet: BindingSetReference,
  ): CanonicalBindingEnvironment {
    const canonical = this.#observeCanonicalEnvironment(consumerId);
    if (!sameBindingSet(canonical.bindingSet, bindingSet)) {
      throw new Error("Canonical Consumer environment assignment is stale.");
    }
    return canonical;
  }

  #observeCanonicalEnvironment(consumerId: string): CanonicalBindingEnvironment {
    const observed = this.#readCanonicalEnvironment(consumerId);
    const snapshotDigest = JSON.stringify({
      ready: observed.ready,
      bindingSet: observed.bindingSet,
      bindings: observed.bindings,
    });
    const current = this.#storage.consumerEnvironmentHeads.get(consumerId);
    if (current?.snapshotDigest === snapshotDigest) {
      return {...observed, generation: current.generation};
    }
    const next = {
      consumerId,
      generation: (current?.generation ?? 0) + 1,
      snapshotDigest,
    };
    this.#storage.consumerEnvironmentHeads.put(next);
    return {...observed, generation: next.generation};
  }
}

/** Creates the Workspace-owned Development Session and Workload attachment lifecycle module. */
export function createConsumerEnvironmentAuthority(
  storage: DurableObjectStorage,
  readCanonicalEnvironment: (consumerId: string) => CanonicalBindingEnvironment,
  recordLifecycleEvent?: (event: ConsumerLifecycleEvent) => void,
): ConsumerEnvironmentAuthority {
  return new ConsumerEnvironmentAuthority(storage, readCanonicalEnvironment, recordLifecycleEvent);
}
