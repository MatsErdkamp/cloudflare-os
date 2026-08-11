import type {
  AgentTaskRecord,
  BindingRecord,
  BindingResolutionRecord,
  ContractInstanceRecord,
  TaskAuthorityCorrelation,
  TaskEnvironmentRecord,
} from "./records";

const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const R2_OPERATIONS = new Set(["head", "get", "list", "put", "delete"]);

/** Host tools present in the version-one Agent Task catalog. */
export const AGENT_TASK_HOST_TOOLS = ["executeCode", "describeBinding", "giveUp"] as const;

/** Normalized authority approved for one task environment. */
export interface EffectiveR2TaskAuthority {
  readonly provider: "cloudflare-r2";
  readonly resources: readonly string[];
  readonly operations: readonly TaskInvocationEnvelope["operation"][];
  readonly resultClasses: readonly TaskInvocationEnvelope["resultClass"][];
  readonly recipients: readonly ["agentModel"];
  readonly egress: readonly [];
  readonly maximumExpiresAt: number;
}

/** One immutable one-shot authorization value accepted by the R2 task mediator. */
export interface TaskInvocationEnvelope {
  readonly invocationId: string;
  readonly correlation: TaskAuthorityCorrelation;
  readonly dispatchDecisionId: string;
  readonly templateApprovalId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly taskEnvironmentGeneration: number;
  readonly ratchetVersion: number;
  readonly bindingId: string;
  readonly bindingGeneration: number;
  readonly resolutionId: string;
  readonly contractInstanceId: string;
  readonly contractInstanceGeneration: number;
  readonly artifactApprovalId: string;
  readonly artifactApprovalEpoch: number;
  readonly providerCapabilityGeneration: number;
  readonly effectiveAuthorityDigest: string;
  readonly effectiveAuthority: EffectiveR2TaskAuthority;
  readonly operation: "head" | "get" | "list" | "put" | "delete";
  readonly resource: string;
  readonly resultClass: "r2Metadata" | "r2Object" | "r2List" | "r2WriteReceipt";
  readonly recipients: readonly ["agentModel"];
  readonly egress: readonly [];
  readonly issuedAt: number;
  readonly deadline: number;
  readonly leaseExpiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly cancellationId: string;
  readonly cancellationGeneration: number;
  readonly mediatorProfile: "r2-task-v1";
  readonly expectedAcknowledgementGeneration: number;
}

/** Separately delivered cancellation companion; it is never serialized into the envelope. */
export interface TaskCancellationCompanion {
  /** Exact cancellation identity carried by the envelope. */
  readonly id: string;
  /** Current cancellation generation. */
  readonly generation: number;
  /** Throws when cancellation has become effective. */
  throwIfCancelled(): void;
  /** Registers cancellation for in-flight Contract/Source work. */
  onCancel(callback: () => void): () => void;
}

/** Capability-free protected-result handle; it contains no provider bytes. */
export interface ProtectedTaskResultReference {
  readonly id: string;
  readonly contentHash: string;
  readonly size: number;
  readonly invocationId: string;
  readonly taskEnvironmentGeneration: number;
  readonly ratchetVersion: number;
  readonly bindingGeneration: number;
}

/** Closed acknowledgement returned by the mediator without protected content. */
export interface TaskInvocationAcknowledgement {
  readonly invocationId: string;
  readonly taskEnvironmentGeneration: number;
  readonly ratchetVersion: number;
  readonly acknowledgementGeneration: number;
  readonly mediatorProfile: "r2-task-v1";
  readonly operation: TaskInvocationEnvelope["operation"];
  readonly outcome: "completed" | "cancelled" | "deadlineExceeded" | "denied" | "failed";
  readonly startedAt: number;
  readonly completedAt: number;
  readonly agentActivityId: string;
  readonly sourceActivityId?: string;
  readonly protectedResult?: ProtectedTaskResultReference;
}

/** Bounded Workspace-owned evidence emitted by the task mediator. */
export interface AgentActivityRecord {
  readonly id: string;
  readonly type: "invocationIssued" | "sourceAttempted" | "sourceCompleted" |
    "resultProtected" | "releaseAcknowledged" | "cancelled" | "deadlineExceeded" |
    "denied" | "failed";
  readonly correlation: TaskAuthorityCorrelation;
  readonly dispatchDecisionId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly taskEnvironmentGeneration: number;
  readonly ratchetVersion: number;
  readonly bindingId: string;
  readonly bindingGeneration: number;
  readonly contractInstanceId: string;
  readonly contractInstanceGeneration: number;
  readonly mediatorProfile: "r2-task-v1";
  readonly invocationId: string;
  readonly cancellationGeneration: number;
  readonly operation: TaskInvocationEnvelope["operation"] |
    "host.executeCode" | "host.describeBinding" | "host.giveUp";
  readonly resultClass: TaskInvocationEnvelope["resultClass"] | "hostToolAcknowledgement";
  readonly outcome?: TaskInvocationAcknowledgement["outcome"];
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly sourceActivityId?: string;
  readonly protectedResultId?: string;
  readonly predecessorActivityId?: string;
}

/** Exact canonical state re-read before invocation and protected-result release. */
export interface AgentTaskExecutionSnapshot {
  readonly task: AgentTaskRecord;
  readonly environment: TaskEnvironmentRecord;
  readonly binding: BindingRecord;
  readonly resolution: BindingResolutionRecord;
  readonly instance: ContractInstanceRecord;
  readonly artifactApprovalEpoch: number;
  readonly providerCapabilityGeneration: number;
  readonly publicTypes: string;
  readonly cancellation: Readonly<{id: string; generation: number}>;
  readonly effectiveAuthority: EffectiveR2TaskAuthority;
}

/** Host operations needed by the deep task mediator module. */
export interface AgentTaskMediatorHost {
  /** Reads current canonical state and returns undefined for any missing lineage. */
  readSnapshot(taskId: string, bindingName: string): AgentTaskExecutionSnapshot | undefined;
  /** Stores bytes outside model context under the complete immutable envelope. */
  protectResult(
    envelope: TaskInvocationEnvelope,
    value: unknown,
  ): Promise<ProtectedTaskResultReference>;
  /** Idempotently releases or replays one protected value under its invocation receipt. */
  releaseResult(
    envelope: TaskInvocationEnvelope,
    reference: ProtectedTaskResultReference,
  ): Promise<Readonly<{value: unknown; firstRelease: boolean}>>;
  /** Revalidates the current release rule without reading protected bytes. */
  authorizeRelease(
    envelope: TaskInvocationEnvelope,
    reference: ProtectedTaskResultReference,
  ): boolean;
  /** Atomically claims an invocation or returns its previously committed outcome. */
  claimInvocation(envelope: TaskInvocationEnvelope):
    | {readonly state: "claimed"}
    | {readonly state: "inProgress"}
    | {readonly state: "completed"; readonly acknowledgement: TaskInvocationAcknowledgement};
  /** Durably records the unique outcome for a claimed invocation. */
  completeInvocation(
    envelope: TaskInvocationEnvelope,
    acknowledgement: TaskInvocationAcknowledgement,
  ): void;
  /** Appends one bounded Agent Activity record. */
  recordActivity(record: AgentActivityRecord): void;
  /** Invokes the exact task Contract Binding; no raw Source capability is accepted. */
  invokeR2(
    envelope: TaskInvocationEnvelope,
    cancellation: TaskCancellationCompanion,
    args: readonly unknown[],
  ): Promise<Readonly<{value: unknown; sourceActivityId?: string}>>;
  /** Opens a generation-bound mediator capability for one Dynamic Worker Binding. */
  openTaskBinding(snapshot: AgentTaskExecutionSnapshot): unknown;
  /** Runs the approved Dynamic Worker profile with no global outbound network. */
  runDynamicWorker(input: Readonly<{
    code: string;
    taskEnvironment: Readonly<{
      taskId: string;
      taskGeneration: number;
      leaseGeneration: number;
      environmentGeneration: number;
      ratchetVersion: number;
    }>;
    bindings: Readonly<Record<string, Readonly<{
      publicTypes: string;
      bindingId: string;
      bindingGeneration: number;
      contractInstanceId: string;
      contractInstanceGeneration: number;
      capability: unknown;
    }>>>;
    globalOutbound: null;
    deadline: number;
    cancellation: TaskCancellationCompanion;
  }>): Promise<unknown>;
  /** Commits the terminal control-only give-up transition. */
  giveUp(taskId: string, expectedTaskGeneration: number): Promise<void>;
}

function sameCorrelation(left: TaskAuthorityCorrelation, right: TaskAuthorityCorrelation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCapabilityFree(value: unknown, path = "envelope"): void {
  if (typeof value === "function") throw new TypeError(`${path} contains a capability.`);
  if (!value || typeof value !== "object") return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new TypeError(`${path} is not capability-free data.`);
  }
  for (const [key, nested] of Object.entries(value)) assertCapabilityFree(nested, `${path}.${key}`);
}

function isUnsupportedAsyncResult(value: unknown): boolean {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return typeof candidate.getReader === "function" ||
    typeof candidate[Symbol.asyncIterator] === "function" ||
    typeof candidate.then === "function";
}

function resultClassForOperation(
  operation: TaskInvocationEnvelope["operation"],
): TaskInvocationEnvelope["resultClass"] {
  switch (operation) {
    case "head": return "r2Metadata";
    case "get": return "r2Object";
    case "list": return "r2List";
    case "put":
    case "delete": return "r2WriteReceipt";
  }
}

function resourceWithin(resource: string, allowed: readonly string[]): boolean {
  return allowed.some(prefix => resource === prefix || resource.startsWith(`${prefix}/`));
}

/** Generation-gated mediator for the deliberately narrow R2 Agent Task runtime. */
export class AgentTaskMediator {
  constructor(
    readonly host: AgentTaskMediatorHost,
    readonly now: () => number = Date.now,
  ) {}

  /** Returns the complete, closed host-tool catalog for Agent Tasks. */
  getHostToolCatalog(): readonly typeof AGENT_TASK_HOST_TOOLS[number][] {
    return AGENT_TASK_HOST_TOOLS;
  }

  /** Creates one one-shot R2 invocation envelope from current canonical task state. */
  createInvocation(input: Readonly<{
    taskId: string;
    bindingName: string;
    operation: TaskInvocationEnvelope["operation"];
    resource: string;
    resultClass: TaskInvocationEnvelope["resultClass"];
    requestedDeadline: number;
  }>): TaskInvocationEnvelope {
    const snapshot = this.host.readSnapshot(input.taskId, input.bindingName);
    const now = this.now();
    if (!snapshot || snapshot.task.lifecycle !== "running" ||
        snapshot.environment.state !== "ready" || snapshot.binding.status !== "active" ||
        snapshot.instance.lifecycle !== "ready" || !R2_OPERATIONS.has(input.operation) ||
        input.resource.length === 0 || input.resource.length > 2_048 ||
        snapshot.task.leaseExpiresAt <= now || snapshot.task.absoluteExpiresAt <= now ||
        snapshot.environment.leaseExpiresAt !== snapshot.task.leaseExpiresAt ||
        snapshot.environment.absoluteExpiresAt !== snapshot.task.absoluteExpiresAt ||
        snapshot.environment.generation !== snapshot.task.environmentGeneration ||
        snapshot.environment.ratchetVersion !== snapshot.task.ratchetVersion) {
      throw new Error("Agent Task invocation is unavailable or stale.");
    }
    const placement = snapshot.environment.bindings.find(candidate =>
      candidate.bindingId === snapshot.binding.id && candidate.name === input.bindingName);
    if (!placement || snapshot.binding.resolutionId !== snapshot.resolution.id ||
        snapshot.binding.contractInstanceId !== snapshot.instance.id ||
        snapshot.resolution.upstreamBinding?.bindingId !== placement.upstreamBinding.bindingId ||
        snapshot.instance.providerBacking?.capabilityGeneration !==
          snapshot.providerCapabilityGeneration) {
      throw new Error("Agent Task Binding lineage is unavailable or stale.");
    }
    if (!snapshot.effectiveAuthority.operations.includes(input.operation) ||
        !resourceWithin(input.resource, snapshot.effectiveAuthority.resources) ||
        input.resultClass !== resultClassForOperation(input.operation) ||
        !snapshot.effectiveAuthority.resultClasses.includes(input.resultClass) ||
        snapshot.effectiveAuthority.recipients.length !== 1 ||
        snapshot.effectiveAuthority.recipients[0] !== "agentModel" ||
        snapshot.effectiveAuthority.egress.length !== 0 ||
        snapshot.effectiveAuthority.maximumExpiresAt < now) {
      throw new Error("R2 invocation exceeds the effective authority envelope.");
    }
    const deadline = Math.min(
      input.requestedDeadline,
      snapshot.task.leaseExpiresAt,
      snapshot.task.absoluteExpiresAt,
      snapshot.effectiveAuthority.maximumExpiresAt,
    );
    if (deadline <= now) throw new Error("Agent Task invocation deadline has elapsed.");
    const envelope: TaskInvocationEnvelope = {
      invocationId: crypto.randomUUID(),
      correlation: structuredClone(snapshot.task.correlation),
      dispatchDecisionId: snapshot.task.dispatchDecisionId,
      templateApprovalId: snapshot.task.templateApprovalId,
      taskGeneration: snapshot.task.generation,
      leaseGeneration: snapshot.task.leaseGeneration,
      taskEnvironmentGeneration: snapshot.environment.generation,
      ratchetVersion: snapshot.environment.ratchetVersion,
      bindingId: snapshot.binding.id,
      bindingGeneration: snapshot.binding.generation,
      resolutionId: snapshot.resolution.id,
      contractInstanceId: snapshot.instance.id,
      contractInstanceGeneration: snapshot.instance.generation,
      artifactApprovalId: snapshot.instance.artifactApprovalId,
      artifactApprovalEpoch: snapshot.artifactApprovalEpoch,
      providerCapabilityGeneration: snapshot.providerCapabilityGeneration,
      effectiveAuthorityDigest: snapshot.environment.effectiveAuthorityDigest,
      effectiveAuthority: structuredClone(snapshot.effectiveAuthority),
      operation: input.operation,
      resource: input.resource,
      resultClass: input.resultClass,
      recipients: ["agentModel"],
      egress: [],
      issuedAt: now,
      deadline,
      leaseExpiresAt: snapshot.task.leaseExpiresAt,
      absoluteExpiresAt: snapshot.task.absoluteExpiresAt,
      cancellationId: snapshot.cancellation.id,
      cancellationGeneration: snapshot.cancellation.generation,
      mediatorProfile: "r2-task-v1",
      expectedAcknowledgementGeneration: 1,
    };
    assertCapabilityFree(envelope);
    this.#activity(envelope, "invocationIssued", now);
    return envelope;
  }

  /** Invokes R2 and returns only an acknowledgement plus protected-result reference. */
  async invoke(
    envelope: TaskInvocationEnvelope,
    cancellation: TaskCancellationCompanion,
    args: readonly unknown[],
  ): Promise<TaskInvocationAcknowledgement> {
    const startedAt = this.now();
    this.#validate(envelope, cancellation);
    assertCapabilityFree(args, "args");
    this.#validateRequest(envelope, args);
    const claim = this.host.claimInvocation(envelope);
    if (claim.state === "completed") return structuredClone(claim.acknowledgement);
    if (claim.state === "inProgress") {
      throw new Error("Agent Task invocation outcome is not yet known.");
    }
    this.#activity(envelope, "sourceAttempted", startedAt);
    try {
      const result = await this.host.invokeR2(envelope, cancellation, args);
      cancellation.throwIfCancelled();
      if (this.now() >= envelope.deadline) {
        const activityId = this.#activity(envelope, "deadlineExceeded", startedAt,
          this.now(), "deadlineExceeded");
        const acknowledgement = this.#ack(envelope, startedAt, "deadlineExceeded",
          activityId, result.sourceActivityId);
        this.host.completeInvocation(envelope, acknowledgement);
        return acknowledgement;
      }
      if (isUnsupportedAsyncResult(result.value)) {
        throw new TypeError("R2 Agent Tasks do not support raw streams, promises, or async iterators.");
      }
      const protectedResult = await this.host.protectResult(envelope, result.value);
      if (!CONTENT_HASH.test(protectedResult.contentHash) ||
          protectedResult.invocationId !== envelope.invocationId ||
          protectedResult.taskEnvironmentGeneration !== envelope.taskEnvironmentGeneration ||
          protectedResult.ratchetVersion !== envelope.ratchetVersion ||
          protectedResult.bindingGeneration !== envelope.bindingGeneration) {
        throw new Error("Protected R2 result differs from its invocation generations.");
      }
      const activityId = this.#activity(
        envelope,
        "resultProtected",
        startedAt,
        this.now(),
        "completed",
        result.sourceActivityId,
        protectedResult.id,
      );
      const acknowledgement = this.#ack(
        envelope,
        startedAt,
        "completed",
        activityId,
        result.sourceActivityId,
        protectedResult,
      );
      this.host.completeInvocation(envelope, acknowledgement);
      return acknowledgement;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = message.toLowerCase().includes("cancel") ? "cancelled" : "failed";
      const activityId = this.#activity(envelope, outcome, startedAt, this.now(), outcome);
      const acknowledgement = this.#ack(envelope, startedAt, outcome, activityId);
      this.host.completeInvocation(envelope, acknowledgement);
      return acknowledgement;
    }
  }

  /** Releases protected bytes only after a second complete generation check. */
  async release(
    envelope: TaskInvocationEnvelope,
    acknowledgement: TaskInvocationAcknowledgement,
  ): Promise<unknown> {
    this.#validate(envelope);
    const reference = acknowledgement.protectedResult;
    if (acknowledgement.outcome !== "completed" || !reference ||
        acknowledgement.invocationId !== envelope.invocationId ||
        acknowledgement.taskEnvironmentGeneration !== envelope.taskEnvironmentGeneration ||
        acknowledgement.ratchetVersion !== envelope.ratchetVersion ||
        acknowledgement.acknowledgementGeneration !== envelope.expectedAcknowledgementGeneration ||
        reference.invocationId !== envelope.invocationId ||
        reference.taskEnvironmentGeneration !== envelope.taskEnvironmentGeneration ||
        reference.ratchetVersion !== envelope.ratchetVersion ||
        reference.bindingGeneration !== envelope.bindingGeneration ||
        !reference.id || !CONTENT_HASH.test(reference.contentHash) ||
        !Number.isSafeInteger(reference.size) || reference.size < 0) {
      throw new Error("Protected R2 result acknowledgement is unavailable or stale.");
    }
    if (!this.host.authorizeRelease(envelope, reference)) {
      throw new Error("Protected R2 result is not eligible for release.");
    }
    const released = await this.host.releaseResult(envelope, reference);
    this.#validate(envelope);
    if (released.firstRelease) {
      this.#activity(envelope, "releaseAcknowledged", this.now(), this.now(), "completed",
        acknowledgement.sourceActivityId, reference.id, acknowledgement.agentActivityId);
    }
    return released.value;
  }

  /** Runs Code Mode with only exact task bindings and no global outbound network. */
  async executeCode(
    taskId: string,
    code: string,
    cancellation: TaskCancellationCompanion,
  ): Promise<unknown> {
    const snapshot = this.host.readSnapshot(taskId, "");
    if (!snapshot || !this.#isLive(snapshot)) {
      throw new Error("Agent Task Code Mode environment is unavailable.");
    }
    if (cancellation.id !== snapshot.cancellation.id ||
        cancellation.generation !== snapshot.cancellation.generation) {
      throw new Error("Agent Task Code Mode cancellation generation is stale.");
    }
    cancellation.throwIfCancelled();
    const bindings = Object.fromEntries(snapshot.environment.bindings.map(binding => {
      const exact = this.host.readSnapshot(taskId, binding.name);
      if (!exact || exact.binding.id !== binding.bindingId || exact.binding.status !== "active") {
        throw new Error("Agent Task Code Mode Binding generation is stale.");
      }
      return [binding.name, {
        publicTypes: exact.publicTypes,
        bindingId: exact.binding.id,
        bindingGeneration: exact.binding.generation,
        contractInstanceId: exact.instance.id,
        contractInstanceGeneration: exact.instance.generation,
        capability: this.host.openTaskBinding(exact),
      }];
    }));
    const startedAt = this.now();
    try {
      const result = await this.host.runDynamicWorker({
        code,
        taskEnvironment: {
          taskId: snapshot.task.id,
          taskGeneration: snapshot.task.generation,
          leaseGeneration: snapshot.task.leaseGeneration,
          environmentGeneration: snapshot.environment.generation,
          ratchetVersion: snapshot.environment.ratchetVersion,
        },
        bindings,
        globalOutbound: null,
        deadline: Math.min(snapshot.task.leaseExpiresAt, snapshot.task.absoluteExpiresAt),
        cancellation,
      });
      cancellation.throwIfCancelled();
      this.#hostToolActivity(snapshot, "executeCode", startedAt, "completed");
      return result;
    } catch (error) {
      this.#hostToolActivity(snapshot, "executeCode", startedAt, "failed");
      throw error;
    }
  }

  /** Returns metadata for one exact current task Binding and no provider value. */
  describeBinding(taskId: string, bindingName: string): string {
    const snapshot = this.host.readSnapshot(taskId, bindingName);
    if (!snapshot || !this.#isLive(snapshot) || snapshot.binding.status !== "active") {
      throw new Error("Agent Task Binding metadata is unavailable.");
    }
    this.#hostToolActivity(snapshot, "describeBinding", this.now(), "completed");
    return snapshot.publicTypes;
  }

  /** Executes the only control-only terminal host tool. */
  giveUp(taskId: string, expectedTaskGeneration: number): Promise<void> {
    const snapshot = this.host.readSnapshot(taskId, "");
    if (!snapshot || !this.#isLive(snapshot) || snapshot.task.generation !== expectedTaskGeneration) {
      throw new Error("Agent Task give-up generation is stale.");
    }
    const startedAt = this.now();
    return this.host.giveUp(taskId, expectedTaskGeneration).then(() => {
      this.#hostToolActivity(snapshot, "giveUp", startedAt, "completed");
    }, error => {
      this.#hostToolActivity(snapshot, "giveUp", startedAt, "failed");
      throw error;
    });
  }

  /** Rejects every tool outside the ADR 0025 catalog. */
  rejectUnsupportedTool(toolName: string): never {
    throw new Error(`Host tool ${toolName} is unavailable to Agent Tasks.`);
  }

  #validate(envelope: TaskInvocationEnvelope, cancellation?: TaskCancellationCompanion): void {
    assertCapabilityFree(envelope);
    const snapshot = this.host.readSnapshot(envelope.correlation.taskId, "");
    const now = this.now();
    if (!snapshot || snapshot.task.lifecycle !== "running" ||
        snapshot.environment.state !== "ready" ||
        !sameCorrelation(snapshot.task.correlation, envelope.correlation) ||
        snapshot.task.dispatchDecisionId !== envelope.dispatchDecisionId ||
        snapshot.task.templateApprovalId !== envelope.templateApprovalId ||
        snapshot.task.generation !== envelope.taskGeneration ||
        snapshot.task.leaseGeneration !== envelope.leaseGeneration ||
        snapshot.environment.generation !== envelope.taskEnvironmentGeneration ||
        snapshot.environment.ratchetVersion !== envelope.ratchetVersion ||
        snapshot.task.leaseExpiresAt !== envelope.leaseExpiresAt ||
        snapshot.task.absoluteExpiresAt !== envelope.absoluteExpiresAt ||
        snapshot.environment.effectiveAuthorityDigest !== envelope.effectiveAuthorityDigest ||
        snapshot.cancellation.id !== envelope.cancellationId ||
        snapshot.cancellation.generation !== envelope.cancellationGeneration ||
        JSON.stringify(snapshot.effectiveAuthority) !== JSON.stringify(envelope.effectiveAuthority) ||
        envelope.resultClass !== resultClassForOperation(envelope.operation) ||
        !snapshot.effectiveAuthority.operations.includes(envelope.operation) ||
        !snapshot.effectiveAuthority.resultClasses.includes(envelope.resultClass) ||
        !resourceWithin(envelope.resource, snapshot.effectiveAuthority.resources) ||
        snapshot.effectiveAuthority.maximumExpiresAt < now ||
        envelope.egress.length !== 0 || envelope.recipients.length !== 1 ||
        envelope.recipients[0] !== "agentModel" || envelope.issuedAt > now ||
        envelope.expectedAcknowledgementGeneration !== 1 || envelope.deadline <= now ||
        envelope.deadline > envelope.effectiveAuthority.maximumExpiresAt ||
        envelope.leaseExpiresAt <= now || envelope.absoluteExpiresAt <= now ||
        envelope.mediatorProfile !== "r2-task-v1") {
      throw new Error("Agent Task invocation generations are stale.");
    }
    if (cancellation && (cancellation.id !== envelope.cancellationId ||
        cancellation.generation !== envelope.cancellationGeneration)) {
      throw new Error("Agent Task cancellation generation is stale.");
    }
    cancellation?.throwIfCancelled();
    const exact = this.host.readSnapshot(envelope.correlation.taskId,
      snapshot.environment.bindings.find(binding => binding.bindingId === envelope.bindingId)?.name ?? "");
    if (!exact || exact.binding.id !== envelope.bindingId ||
        exact.binding.generation !== envelope.bindingGeneration ||
        exact.resolution.id !== envelope.resolutionId ||
        exact.instance.id !== envelope.contractInstanceId ||
        exact.instance.generation !== envelope.contractInstanceGeneration ||
        exact.instance.artifactApprovalId !== envelope.artifactApprovalId ||
        exact.artifactApprovalEpoch !== envelope.artifactApprovalEpoch ||
        exact.providerCapabilityGeneration !== envelope.providerCapabilityGeneration) {
      throw new Error("Agent Task Binding generations are stale.");
    }
  }

  #ack(
    envelope: TaskInvocationEnvelope,
    startedAt: number,
    outcome: TaskInvocationAcknowledgement["outcome"],
    agentActivityId: string,
    sourceActivityId?: string,
    protectedResult?: ProtectedTaskResultReference,
  ): TaskInvocationAcknowledgement {
    return {
      invocationId: envelope.invocationId,
      taskEnvironmentGeneration: envelope.taskEnvironmentGeneration,
      ratchetVersion: envelope.ratchetVersion,
      acknowledgementGeneration: envelope.expectedAcknowledgementGeneration,
      mediatorProfile: "r2-task-v1",
      operation: envelope.operation,
      outcome,
      startedAt,
      completedAt: this.now(),
      agentActivityId,
      sourceActivityId,
      protectedResult,
    };
  }

  #activity(
    envelope: TaskInvocationEnvelope,
    type: AgentActivityRecord["type"],
    startedAt: number,
    completedAt?: number,
    outcome?: AgentActivityRecord["outcome"],
    sourceActivityId?: string,
    protectedResultId?: string,
    predecessorActivityId?: string,
  ): string {
    const id = crypto.randomUUID();
    this.host.recordActivity({
      id,
      type,
      correlation: structuredClone(envelope.correlation),
      dispatchDecisionId: envelope.dispatchDecisionId,
      taskGeneration: envelope.taskGeneration,
      leaseGeneration: envelope.leaseGeneration,
      taskEnvironmentGeneration: envelope.taskEnvironmentGeneration,
      ratchetVersion: envelope.ratchetVersion,
      bindingId: envelope.bindingId,
      bindingGeneration: envelope.bindingGeneration,
      contractInstanceId: envelope.contractInstanceId,
      contractInstanceGeneration: envelope.contractInstanceGeneration,
      mediatorProfile: "r2-task-v1",
      invocationId: envelope.invocationId,
      cancellationGeneration: envelope.cancellationGeneration,
      operation: envelope.operation,
      resultClass: envelope.resultClass,
      outcome,
      startedAt,
      completedAt,
      sourceActivityId,
      protectedResultId,
      predecessorActivityId,
    });
    return id;
  }

  #isLive(snapshot: AgentTaskExecutionSnapshot): boolean {
    const now = this.now();
    return snapshot.task.lifecycle === "running" && snapshot.environment.state === "ready" &&
      snapshot.task.leaseExpiresAt > now && snapshot.task.absoluteExpiresAt > now &&
      snapshot.environment.generation === snapshot.task.environmentGeneration &&
      snapshot.environment.ratchetVersion === snapshot.task.ratchetVersion &&
      snapshot.environment.leaseGeneration === snapshot.task.leaseGeneration &&
      snapshot.environment.leaseExpiresAt === snapshot.task.leaseExpiresAt &&
      snapshot.environment.absoluteExpiresAt === snapshot.task.absoluteExpiresAt &&
      sameCorrelation(snapshot.task.correlation, snapshot.environment.correlation);
  }

  #validateRequest(envelope: TaskInvocationEnvelope, args: readonly unknown[]): void {
    const requiredLength = envelope.operation === "put" ? 2 : 1;
    if (args.length !== requiredLength || args[0] !== envelope.resource) {
      throw new Error("R2 invocation request differs from its authorized resource.");
    }
  }

  #hostToolActivity(
    snapshot: AgentTaskExecutionSnapshot,
    tool: typeof AGENT_TASK_HOST_TOOLS[number],
    startedAt: number,
    outcome: "completed" | "failed",
  ): void {
    this.host.recordActivity({
      id: crypto.randomUUID(),
      type: outcome === "completed" ? "sourceCompleted" : "failed",
      correlation: structuredClone(snapshot.task.correlation),
      dispatchDecisionId: snapshot.task.dispatchDecisionId,
      taskGeneration: snapshot.task.generation,
      leaseGeneration: snapshot.task.leaseGeneration,
      taskEnvironmentGeneration: snapshot.environment.generation,
      ratchetVersion: snapshot.environment.ratchetVersion,
      bindingId: snapshot.binding.id,
      bindingGeneration: snapshot.binding.generation,
      contractInstanceId: snapshot.instance.id,
      contractInstanceGeneration: snapshot.instance.generation,
      mediatorProfile: "r2-task-v1",
      invocationId: crypto.randomUUID(),
      cancellationGeneration: snapshot.cancellation.generation,
      operation: `host.${tool}`,
      resultClass: "hostToolAcknowledgement",
      startedAt,
      completedAt: this.now(),
      outcome,
    });
  }
}
