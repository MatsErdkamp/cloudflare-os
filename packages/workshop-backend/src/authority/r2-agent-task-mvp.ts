import type {
  ProtectedTaskResultReference,
  TaskCancellationCompanion,
  TaskInvocationAcknowledgement,
  TaskInvocationEnvelope,
} from "./agent-task-mediator";
import type {
  RatchetBindingChange,
  RatchetEnvironmentSnapshot,
} from "./trust-ratchet";
import type {ContractInvalidationAcknowledgement} from "@gadgets/contractors/runtime";

/** Narrow mediator seam consumed by the end-to-end R2 workflow. */
export interface R2TaskMediatorPort {
  /** Creates one exact R2 invocation from current canonical state. */
  createInvocation(input: Readonly<{
    taskId: string;
    bindingName: string;
    operation: TaskInvocationEnvelope["operation"];
    resource: string;
    resultClass: TaskInvocationEnvelope["resultClass"];
    requestedDeadline: number;
  }>): TaskInvocationEnvelope;
  /** Invokes through the Contract Binding and protects the result. */
  invoke(
    envelope: TaskInvocationEnvelope,
    cancellation: TaskCancellationCompanion,
    args: readonly unknown[],
  ): Promise<TaskInvocationAcknowledgement>;
}

/** Narrow Trust Ratchet seam consumed by the end-to-end R2 workflow. */
export interface R2TaskRatchetPort {
  /** Replaces the complete Task Environment with a narrower generation. */
  transition(input: Readonly<{
    transitionId: string;
    taskId: string;
    expectedTaskGeneration: number;
    expectedEnvironmentGeneration: number;
    expectedRatchetVersion: number;
    nextExpiresAt: number;
    changes: readonly RatchetBindingChange[];
  }>): Promise<RatchetEnvironmentSnapshot>;
}

/** Current canonical task facts required by the tracer-bullet workflow. */
export interface R2AgentTaskMvpState {
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly environmentGeneration: number;
  readonly ratchetVersion: number;
  readonly leaseExpiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly cancellationId: string;
  readonly cancellationGeneration: number;
  readonly cancellationState: "active" | "requested";
  readonly networkGeneration: number;
  readonly ambientSourceCount: number;
  readonly unrestrictedEgressCount: number;
  readonly authorityDebtRefs: readonly string[];
  readonly lifecycle: "running" | "completed" | "cancelled" | "failed" | "expired";
}

/** Exact post-Ratchet release request; protected content is not part of this value. */
export interface RatchetedProtectedRelease {
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly parentEnvironmentGeneration: number;
  readonly parentRatchetVersion: number;
  readonly currentEnvironmentGeneration: number;
  readonly currentRatchetVersion: number;
  readonly networkGeneration: number;
  readonly invocationId: string;
  readonly acknowledgementGeneration: number;
  readonly protectedResult: ProtectedTaskResultReference;
  readonly cancellationId: string;
  readonly cancellationGeneration: number;
}

/** Exact acknowledgement returned before protected bytes enter model context. */
export interface RatchetedReleaseAcknowledgement {
  readonly releaseReceiptId: string;
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly environmentGeneration: number;
  readonly ratchetVersion: number;
  readonly networkGeneration: number;
  readonly invocationId: string;
  readonly protectedResultId: string;
  readonly contentHash: string;
  readonly state: "released";
}

/** Exact acknowledgement that no Task authority remains reachable. */
export interface AgentTaskDestructionAcknowledgement {
  readonly taskId: string;
  readonly priorTaskGeneration: number;
  readonly terminalTaskGeneration: number;
  readonly outcome: "completed" | "cancelled" | "failed" | "expired";
  readonly endpoints: readonly ContractInvalidationAcknowledgement[];
  readonly contractInstances: 0;
  readonly bindings: 0;
  readonly environments: 0;
  readonly egressCapabilities: 0;
  readonly leases: 0;
  readonly callbacks: 0;
  readonly subscriptions: 0;
  readonly restorationCapabilities: 0;
}

/** Durable terminal operation identity used to resume destruction after a crash. */
export interface AgentTaskTerminalIntent {
  readonly operationId: string;
  readonly taskId: string;
  readonly expectedTaskGeneration: number;
  readonly expectedEnvironmentGeneration: number;
  readonly expectedRatchetVersion: number;
  readonly outcome: AgentTaskDestructionAcknowledgement["outcome"];
}

/** Host operations retaining canonical storage and provider details outside the workflow. */
export interface R2AgentTaskMvpHost {
  /** Dispatches the approved template from one canonical Agent Service Workload. */
  dispatch(input: Readonly<{
    operationId: string;
    taskTemplateApprovalId: string;
    agentServiceProfileId: string;
    principalId: string;
  }>): Promise<R2AgentTaskMvpState>;
  /** Reads current canonical task facts. */
  readState(taskId: string): R2AgentTaskMvpState | undefined;
  /** Opens the generation-gated mediator for the dispatched task. */
  openMediator(taskId: string): R2TaskMediatorPort;
  /** Opens the subset-only Trust Ratchet for the dispatched task. */
  openRatchet(taskId: string): R2TaskRatchetPort;
  /** Returns the canonical cancellation companion for current task work. */
  cancellation(taskId: string): TaskCancellationCompanion;
  /** Authorizes release and returns an exact acknowledgement without exposing protected bytes. */
  authorizeProtectedObservation(
    request: RatchetedProtectedRelease,
  ): Promise<RatchetedReleaseAcknowledgement>;
  /** Delivers bytes only for the exact acknowledgement already validated by the workflow. */
  deliverProtectedObservation(
    request: RatchetedProtectedRelease,
    acknowledgement: RatchetedReleaseAcknowledgement,
  ): Promise<unknown>;
  /** Records bounded operational references for the authority review surface. */
  recordOperationalEvidence(input: Readonly<{
    taskId: string;
    taskGeneration: number;
    environmentGeneration: number;
    ratchetVersion: number;
    protectedResultRef: string;
    sourceActivityRef?: string;
    agentActivityRef: string;
    authorityDebtRefs: readonly string[];
  }>): void;
  /** Begins or exactly recovers one durable terminal operation. */
  beginTerminal(intent: AgentTaskTerminalIntent): Promise<AgentTaskTerminalIntent>;
  /** Invalidates all Task reachability under the durable terminal intent. */
  destroyTaskAuthority(intent: AgentTaskTerminalIntent): Promise<AgentTaskDestructionAcknowledgement>;
  /** Commits the terminal state after exact destruction acknowledgement. */
  commitTerminal(
    intent: AgentTaskTerminalIntent,
    acknowledgement: AgentTaskDestructionAcknowledgement,
  ): Promise<void>;
}

function assertReleased(
  request: RatchetedProtectedRelease,
  acknowledgement: RatchetedReleaseAcknowledgement,
): void {
  if (!acknowledgement.releaseReceiptId || acknowledgement.taskId !== request.taskId ||
      acknowledgement.taskGeneration !== request.taskGeneration ||
      acknowledgement.leaseGeneration !== request.leaseGeneration ||
      acknowledgement.environmentGeneration !== request.currentEnvironmentGeneration ||
      acknowledgement.ratchetVersion !== request.currentRatchetVersion ||
      acknowledgement.networkGeneration !== request.networkGeneration ||
      acknowledgement.invocationId !== request.invocationId ||
      acknowledgement.protectedResultId !== request.protectedResult.id ||
      acknowledgement.contentHash !== request.protectedResult.contentHash ||
      acknowledgement.state !== "released") {
    throw new Error("Protected R2 observation release acknowledgement is stale or ambiguous.");
  }
}

/** One operable R2 Agent Task tracer bullet across dispatch, mediation, Ratchet, and teardown. */
export class R2AgentTaskMvp {
  constructor(readonly host: R2AgentTaskMvpHost) {}

  /** Executes one protected observation, narrows once, releases, and destroys the task. */
  async run(input: Readonly<{
    operationId: string;
    taskTemplateApprovalId: string;
    agentServiceProfileId: string;
    principalId: string;
    bindingName: string;
    resource: string;
    narrowerChanges: readonly RatchetBindingChange[];
    narrowerExpiresAt: number;
  }>): Promise<unknown> {
    const initial = await this.host.dispatch(input);
    if (initial.lifecycle !== "running" || initial.ambientSourceCount !== 0 ||
        initial.unrestrictedEgressCount !== 0 || initial.authorityDebtRefs.length === 0) {
      throw new Error("R2 Agent Task dispatch did not produce the closed authority environment.");
    }
    try {
      const mediator = this.host.openMediator(initial.taskId);
      const cancellation = this.host.cancellation(initial.taskId);
      if (initial.cancellationState !== "active" || cancellation.id !== initial.cancellationId ||
          cancellation.generation !== initial.cancellationGeneration) {
        throw new Error("R2 Agent Task cancellation companion is stale.");
      }
      const envelope = mediator.createInvocation({
        taskId: initial.taskId,
        bindingName: input.bindingName,
        operation: "get",
        resource: input.resource,
        resultClass: "r2Object",
        requestedDeadline: Math.min(initial.leaseExpiresAt, initial.absoluteExpiresAt),
      });
      const invocation = await mediator.invoke(envelope, cancellation, [input.resource]);
      if (invocation.outcome !== "completed" || !invocation.protectedResult) {
        throw new Error(`Protected R2 observation did not complete: ${invocation.outcome}`);
      }
      const next = await this.host.openRatchet(initial.taskId).transition({
        transitionId: `${input.operationId}:ratchet`,
        taskId: initial.taskId,
        expectedTaskGeneration: initial.taskGeneration,
        expectedEnvironmentGeneration: initial.environmentGeneration,
        expectedRatchetVersion: initial.ratchetVersion,
        nextExpiresAt: input.narrowerExpiresAt,
        changes: input.narrowerChanges,
      });
      if (next.generation !== initial.environmentGeneration + 1 ||
          next.ratchetVersion !== initial.ratchetVersion + 1) {
        throw new Error("Trust Ratchet did not publish the expected next generation.");
      }
      const current = this.host.readState(initial.taskId);
      if (!current || current.environmentGeneration !== next.generation ||
          current.ratchetVersion !== next.ratchetVersion || current.lifecycle !== "running") {
        throw new Error("Narrower Task Environment is not canonical and live.");
      }
      const release: RatchetedProtectedRelease = {
        taskId: current.taskId,
        taskGeneration: current.taskGeneration,
        leaseGeneration: current.leaseGeneration,
        parentEnvironmentGeneration: envelope.taskEnvironmentGeneration,
        parentRatchetVersion: envelope.ratchetVersion,
        currentEnvironmentGeneration: current.environmentGeneration,
        currentRatchetVersion: current.ratchetVersion,
        networkGeneration: current.networkGeneration,
        invocationId: envelope.invocationId,
        acknowledgementGeneration: invocation.acknowledgementGeneration,
        protectedResult: invocation.protectedResult,
        cancellationId: current.cancellationId,
        cancellationGeneration: current.cancellationGeneration,
      };
      if (current.cancellationState !== "active") {
        await this.terminate(current.taskId, "cancelled", `${input.operationId}:cancelled`);
        throw new Error("Agent Task cancellation became effective before protected release.");
      }
      const releaseAcknowledgement = await this.host.authorizeProtectedObservation(release);
      assertReleased(release, releaseAcknowledgement);
      const deliveryState = this.host.readState(current.taskId);
      if (!deliveryState || deliveryState.lifecycle !== "running" ||
          deliveryState.cancellationState !== "active" ||
          deliveryState.taskGeneration !== release.taskGeneration ||
          deliveryState.leaseGeneration !== release.leaseGeneration ||
          deliveryState.environmentGeneration !== release.currentEnvironmentGeneration ||
          deliveryState.ratchetVersion !== release.currentRatchetVersion ||
          deliveryState.networkGeneration !== release.networkGeneration) {
        throw new Error("Protected R2 observation release became stale before delivery.");
      }
      const value = await this.host.deliverProtectedObservation(release, releaseAcknowledgement);
      this.host.recordOperationalEvidence({
        taskId: current.taskId,
        taskGeneration: current.taskGeneration,
        environmentGeneration: current.environmentGeneration,
        ratchetVersion: current.ratchetVersion,
        protectedResultRef: invocation.protectedResult.id,
        sourceActivityRef: invocation.sourceActivityId,
        agentActivityRef: invocation.agentActivityId,
        authorityDebtRefs: current.authorityDebtRefs,
      });
      await this.terminate(current.taskId, "completed", `${input.operationId}:completed`);
      return value;
    } catch (error) {
      const current = this.host.readState(initial.taskId);
      if (current?.lifecycle === "running") {
        await this.terminate(initial.taskId, "failed", `${input.operationId}:failed`);
      }
      throw error;
    }
  }

  /** Destroys every reachability class before committing a terminal Task outcome. */
  async terminate(
    taskId: string,
    outcome: AgentTaskDestructionAcknowledgement["outcome"],
    operationId = `terminal:${taskId}:${outcome}`,
  ): Promise<void> {
    const current = this.host.readState(taskId);
    if (!current || current.lifecycle !== "running") {
      throw new Error("Agent Task is unavailable or already terminal.");
    }
    const intent = await this.host.beginTerminal({
      operationId,
      taskId,
      expectedTaskGeneration: current.taskGeneration,
      expectedEnvironmentGeneration: current.environmentGeneration,
      expectedRatchetVersion: current.ratchetVersion,
      outcome,
    });
    const acknowledgement = await this.host.destroyTaskAuthority(intent);
    if (acknowledgement.taskId !== taskId ||
        acknowledgement.priorTaskGeneration !== current.taskGeneration ||
        acknowledgement.terminalTaskGeneration !== current.taskGeneration + 1 ||
        acknowledgement.outcome !== outcome ||
        acknowledgement.endpoints.length === 0 ||
        acknowledgement.endpoints.some(endpoint =>
          !endpoint.invalidated || endpoint.cleanupFailures !== 0) ||
        Object.entries(acknowledgement).some(([key, value]) =>
          key !== "taskId" && key !== "priorTaskGeneration" &&
          key !== "terminalTaskGeneration" && key !== "outcome" && key !== "endpoints" &&
          value !== 0)) {
      throw new Error("Agent Task destruction acknowledgement is incomplete.");
    }
    await this.host.commitTerminal(intent, acknowledgement);
  }
}
