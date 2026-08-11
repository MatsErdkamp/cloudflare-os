import {describe, expect, it} from "vitest";

import {
  R2AgentTaskMvp,
  type AgentTaskDestructionAcknowledgement,
  type R2AgentTaskMvpHost,
  type R2AgentTaskMvpState,
} from "../src/authority/r2-agent-task-mvp.js";
import {
  AgentTaskMediator,
  type AgentTaskExecutionSnapshot,
  type TaskInvocationAcknowledgement,
  type TaskInvocationEnvelope,
} from "../src/authority/agent-task-mediator.js";
import {
  TrustRatchet,
  type RatchetBindingAuthority,
  type RatchetEnvironmentSnapshot,
  type TrustRatchetTransition,
} from "../src/authority/trust-ratchet.js";

const parentBinding: RatchetBindingAuthority = {
  name: "R2_STORAGE",
  requirementId: "requirement-1",
  bindingId: "binding-1",
  bindingGeneration: 1,
  contractInstanceId: "instance-1",
  contractInstanceGeneration: 1,
  authority: {
    provider: "cloudflare-r2",
    resourceIdentity: "approved",
    upstreamAuthorityIdentity: "source-1:1",
    artifactApprovalId: "artifact-approval-1",
    artifactApprovalEpoch: 1,
    operations: ["get", "put"],
    recipients: ["agentModel"],
    egress: [],
    releaseClasses: ["r2Object", "r2WriteReceipt"],
    sharing: "isolated",
    enforcementProfile: "r2-task-v1",
    maximumExpiresAt: 40_000,
  },
};

const narrowerBinding: RatchetBindingAuthority = {
  ...parentBinding,
  bindingId: "binding-2",
  contractInstanceId: "instance-2",
  authority: {
    ...parentBinding.authority,
    operations: ["get"],
    releaseClasses: ["r2Object"],
    maximumExpiresAt: 30_000,
  },
};

function makeHarness() {
  const order: string[] = [];
  let protectedOutsideModel = false;
  let state: R2AgentTaskMvpState = {
    taskId: "task-1",
    taskGeneration: 1,
    leaseGeneration: 1,
    environmentGeneration: 1,
    ratchetVersion: 1,
    leaseExpiresAt: 40_000,
    absoluteExpiresAt: 50_000,
    cancellationId: "cancellation-1",
    cancellationGeneration: 1,
    cancellationState: "active",
    networkGeneration: 1,
    ambientSourceCount: 0,
    unrestrictedEgressCount: 0,
    authorityDebtRefs: ["authority-debt:broader-r2-provider"],
    lifecycle: "running",
  };
  let lastEnvelope: TaskInvocationEnvelope | undefined;
  let badReleaseAck = false;
  let cancelOnRatchet = false;
  let failTerminalCommit = false;
  let cancelAfterAuthorize = false;
  const deliveredReceipts = new Set<string>();
  const terminalIntents = new Map<string, string>();
  const terminalOutcomes = new Map<string, AgentTaskDestructionAcknowledgement>();
  let ratchetCurrent: RatchetEnvironmentSnapshot = {
    taskId: "task-1",
    taskActive: true,
    taskGeneration: 1,
    leaseGeneration: 1,
    generation: 1,
    ratchetVersion: 1,
    leaseExpiresAt: 40_000,
    absoluteExpiresAt: 50_000,
    correlation: {
      taskId: "task-1" as never,
      taskGeneration: 1,
      principal: {id: "principal-1", generation: 1},
      actorChain: [{type: "workspacePrincipal", id: "principal-1", generation: 1}],
    },
    bindings: [parentBinding],
    permanentlyRemoved: [],
  };
  const transitions = new Map<string, {transition: TrustRatchetTransition;
    state: "pending" | "committed"; environment?: RatchetEnvironmentSnapshot}>();
  const ratchet = new TrustRatchet({
    readTransition: id => transitions.get(id),
    readCurrent: () => structuredClone(ratchetCurrent),
    async persistTransition(transition) {
      order.push("ratchet-persisted");
      transitions.set(transition.id, {transition: structuredClone(transition), state: "pending"});
    },
    async holdProtectedResults() {
      expect(protectedOutsideModel).toBe(true);
      order.push("ratchet-held");
    },
    async prepareBinding(transition, binding) {
      order.push("ratchet-prepared");
      return {
        transitionId: transition.id,
        taskId: transition.taskId,
        taskGeneration: transition.taskGeneration,
        leaseGeneration: transition.leaseGeneration,
        environmentGeneration: transition.nextEnvironmentGeneration,
        ratchetVersion: transition.nextRatchetVersion,
        bindingId: binding.bindingId,
        bindingGeneration: binding.bindingGeneration,
        contractInstanceId: binding.contractInstanceId,
        contractInstanceGeneration: binding.contractInstanceGeneration,
        state: "prepared",
      };
    },
    async invalidatePredecessor(transition, binding) {
      order.push("ratchet-invalidated-old");
      return {
        transitionId: transition.id,
        taskId: transition.taskId,
        taskGeneration: transition.taskGeneration,
        leaseGeneration: transition.leaseGeneration,
        environmentGeneration: transition.nextEnvironmentGeneration,
        ratchetVersion: transition.nextRatchetVersion,
        bindingId: binding.bindingId,
        bindingGeneration: binding.bindingGeneration,
        contractInstanceId: binding.contractInstanceId,
        contractInstanceGeneration: binding.contractInstanceGeneration,
        state: "invalidated",
      };
    },
    async commitTransition(transition) {
      order.push("ratchet-committed");
      ratchetCurrent = {
        ...ratchetCurrent,
        generation: transition.nextEnvironmentGeneration,
        ratchetVersion: transition.nextRatchetVersion,
        leaseExpiresAt: transition.nextExpiresAt,
        bindings: transition.nextBindings,
        permanentlyRemoved: transition.permanentlyRemoved,
      };
      transitions.set(transition.id, {transition: structuredClone(transition), state: "committed",
        environment: structuredClone(ratchetCurrent)});
      return structuredClone(ratchetCurrent);
    },
    async publishEnvironment(transition) {
      order.push("ratchet-published");
      state = {...state, environmentGeneration: transition.nextEnvironmentGeneration,
        ratchetVersion: transition.nextRatchetVersion, networkGeneration: 2,
        leaseExpiresAt: transition.nextExpiresAt,
        cancellationState: cancelOnRatchet ? "requested" : "active"};
      executionSnapshot = {
        ...executionSnapshot,
        task: {...executionSnapshot.task,
          environmentGeneration: transition.nextEnvironmentGeneration,
          ratchetVersion: transition.nextRatchetVersion},
        environment: {...executionSnapshot.environment,
          generation: transition.nextEnvironmentGeneration,
          ratchetVersion: transition.nextRatchetVersion,
          leaseExpiresAt: transition.nextExpiresAt,
          bindings: [{name: "R2_STORAGE", bindingId: "binding-2",
            upstreamBinding: {bindingId: "standing-binding-1"}}]},
        binding: {...executionSnapshot.binding, id: "binding-2", contractInstanceId: "instance-2",
          resolutionId: "resolution-2"},
        resolution: {...executionSnapshot.resolution, id: "resolution-2"},
        instance: {...executionSnapshot.instance, id: "instance-2"},
      } as unknown as AgentTaskExecutionSnapshot;
      return {
        transitionId: transition.id,
        taskId: transition.taskId,
        taskGeneration: transition.taskGeneration,
        leaseGeneration: transition.leaseGeneration,
        environmentGeneration: transition.nextEnvironmentGeneration,
        ratchetVersion: transition.nextRatchetVersion,
        bindings: transition.nextBindings.map(binding => ({
          bindingId: binding.bindingId,
          bindingGeneration: binding.bindingGeneration,
          contractInstanceId: binding.contractInstanceId,
          contractInstanceGeneration: binding.contractInstanceGeneration,
        })),
      };
    },
  });
  const cancellation = {
    id: "cancellation-1",
    generation: 1,
    throwIfCancelled() {},
    onCancel() { return () => {}; },
  };
  const invocationReceipts = new Map<string, TaskInvocationAcknowledgement>();
  let executionSnapshot = {
    task: {
      id: "task-1",
      generation: 1,
      dispatchDecisionId: "dispatch-1",
      templateApprovalId: "template-approval-1",
      leaseGeneration: 1,
      leaseExpiresAt: 40_000,
      absoluteExpiresAt: 50_000,
      environmentGeneration: 1,
      ratchetVersion: 1,
      lifecycle: "running",
      correlation: ratchetCurrent.correlation,
    },
    environment: {
      state: "ready",
      generation: 1,
      ratchetVersion: 1,
      leaseGeneration: 1,
      leaseExpiresAt: 40_000,
      absoluteExpiresAt: 50_000,
      effectiveAuthorityDigest: `sha256:${"a".repeat(64)}`,
      bindings: [{name: "R2_STORAGE", bindingId: "binding-1",
        upstreamBinding: {bindingId: "standing-binding-1"}}],
      correlation: ratchetCurrent.correlation,
    },
    binding: {id: "binding-1", generation: 1, status: "active",
      resolutionId: "resolution-1", contractInstanceId: "instance-1"},
    resolution: {id: "resolution-1",
      upstreamBinding: {bindingId: "standing-binding-1"}},
    instance: {id: "instance-1", generation: 1, lifecycle: "ready",
      artifactApprovalId: "artifact-approval-1",
      providerBacking: {capabilityGeneration: 1}},
    artifactApprovalEpoch: 1,
    providerCapabilityGeneration: 1,
    publicTypes: "export interface R2Storage { get(key: string): Promise<unknown> }",
    cancellation: {id: cancellation.id, generation: cancellation.generation},
    effectiveAuthority: {
      provider: "cloudflare-r2",
      resources: ["approved"],
      operations: ["get"],
      resultClasses: ["r2Object"],
      recipients: ["agentModel"],
      egress: [],
      maximumExpiresAt: 40_000,
    },
  } as unknown as AgentTaskExecutionSnapshot;
  const mediator = new AgentTaskMediator({
    readSnapshot(taskId, bindingName) {
      if (taskId !== state.taskId || (bindingName && bindingName !== "R2_STORAGE")) return undefined;
      return structuredClone(executionSnapshot);
    },
    async protectResult(envelope, value) {
      protectedOutsideModel = true;
      return {
        id: "protected-result:1",
        contentHash: `sha256:${"b".repeat(64)}`,
        size: JSON.stringify(value).length,
        invocationId: envelope.invocationId,
        taskEnvironmentGeneration: envelope.taskEnvironmentGeneration,
        ratchetVersion: envelope.ratchetVersion,
        bindingGeneration: envelope.bindingGeneration,
      };
    },
    async releaseResult() { throw new Error("Ratchet release uses the workflow gate."); },
    authorizeRelease() { return false; },
    claimInvocation(envelope) {
      const acknowledgement = invocationReceipts.get(envelope.invocationId);
      return acknowledgement ? {state: "completed" as const, acknowledgement} :
        {state: "claimed" as const};
    },
    completeInvocation(envelope, acknowledgement) {
      invocationReceipts.set(envelope.invocationId, structuredClone(acknowledgement));
    },
    recordActivity() {},
    async invokeR2() {
      order.push("provider-get");
      return {value: {body: "r2-observation"}, sourceActivityId: "source-activity:get"};
    },
    openTaskBinding() { return {}; },
    async runDynamicWorker() { return undefined; },
    async giveUp() {},
  }, () => 1_000);
  const host: R2AgentTaskMvpHost = {
    async dispatch() {
      order.push("dispatch");
      return structuredClone(state);
    },
    readState(taskId) {
      return taskId === state.taskId ? structuredClone(state) : undefined;
    },
    openMediator() {
      return {
        createInvocation(input) {
          order.push("invoke-issued");
          lastEnvelope = mediator.createInvocation(input);
          return lastEnvelope;
        },
        invoke: (envelope, companion, args) => mediator.invoke(envelope, companion, args),
      };
    },
    openRatchet() {
      return ratchet;
    },
    cancellation() { return cancellation; },
    async authorizeProtectedObservation(request) {
      expect(order).toContain("ratchet-published");
      order.push("release-authorized");
      if (cancelAfterAuthorize) state = {...state, cancellationState: "requested"};
      return {
          releaseReceiptId: "release-receipt:1",
          taskId: request.taskId,
          taskGeneration: request.taskGeneration,
          leaseGeneration: request.leaseGeneration,
          environmentGeneration: request.currentEnvironmentGeneration,
          ratchetVersion: badReleaseAck ? 1 : request.currentRatchetVersion,
          networkGeneration: request.networkGeneration,
          invocationId: request.invocationId,
          protectedResultId: request.protectedResult.id,
          contentHash: request.protectedResult.contentHash,
          state: "released",
      };
    },
    async deliverProtectedObservation(request, acknowledgement) {
      if (state.cancellationState !== "active" ||
          state.environmentGeneration !== request.currentEnvironmentGeneration ||
          deliveredReceipts.has(acknowledgement.releaseReceiptId)) {
        throw new Error("release receipt stale or already consumed");
      }
      deliveredReceipts.add(acknowledgement.releaseReceiptId);
      order.push("released");
      protectedOutsideModel = false;
      return {body: "r2-observation"};
    },
    recordOperationalEvidence(input) {
      order.push("evidence");
      expect(input.authorityDebtRefs).toEqual(["authority-debt:broader-r2-provider"]);
    },
    async beginTerminal(intent) {
      order.push("terminal-begun");
      const encoded = JSON.stringify(intent);
      const previous = terminalIntents.get(intent.operationId);
      if (previous && previous !== encoded) throw new Error("terminal idempotency conflict");
      terminalIntents.set(intent.operationId, encoded);
      return intent;
    },
    async destroyTaskAuthority(input) {
      order.push(`destroy:${input.outcome}`);
      const previous = terminalOutcomes.get(input.operationId);
      if (previous) return previous;
      const acknowledgement: AgentTaskDestructionAcknowledgement = {
        taskId: input.taskId,
        priorTaskGeneration: input.expectedTaskGeneration,
        terminalTaskGeneration: input.expectedTaskGeneration + 1,
        outcome: input.outcome,
        endpoints: [{
          endpointId: "contract-instance:instance-2",
          reachabilityGeneration: 1,
          invalidated: true,
          cancelledInvocations: 1,
          cleanupFailures: 0,
        }],
        contractInstances: 0,
        bindings: 0,
        environments: 0,
        egressCapabilities: 0,
        leases: 0,
        callbacks: 0,
        subscriptions: 0,
        restorationCapabilities: 0,
      };
      terminalOutcomes.set(input.operationId, acknowledgement);
      return acknowledgement;
    },
    async commitTerminal(_intent, acknowledgement) {
      order.push("terminal-committed");
      if (failTerminalCommit) throw new Error("terminal commit unavailable");
      state = {...state, taskGeneration: acknowledgement.terminalTaskGeneration,
        lifecycle: acknowledgement.outcome};
    },
  };
  return {
    workflow: new R2AgentTaskMvp(host),
    order,
    get state() { return state; },
    get lastEnvelope() { return lastEnvelope; },
    invokeOld() {
      if (!lastEnvelope) throw new Error("no predecessor invocation");
      return host.openMediator("task-1").invoke(lastEnvelope, cancellation, [lastEnvelope.resource]);
    },
    set badReleaseAck(value: boolean) { badReleaseAck = value; },
    set cancelOnRatchet(value: boolean) { cancelOnRatchet = value; },
    set failTerminalCommit(value: boolean) { failTerminalCommit = value; },
    set cancelAfterAuthorize(value: boolean) { cancelAfterAuthorize = value; },
  };
}

const input = {
  operationId: "r2-task-mvp-1",
  taskTemplateApprovalId: "template-approval-1",
  agentServiceProfileId: "agent-service-1",
  principalId: "principal-1",
  bindingName: "R2_STORAGE",
  resource: "approved/file.txt",
  narrowerChanges: [{type: "replace" as const, bindingId: "binding-1",
    replacement: narrowerBinding}],
  narrowerExpiresAt: 30_000,
};

describe("R2 Agent Task Authority MVP", () => {
  it("withholds R2 data through narrowing and destroys all authority after completion", async () => {
    const test = makeHarness();
    await expect(test.workflow.run(input)).resolves.toEqual({body: "r2-observation"});
    expect(test.order).toEqual([
      "dispatch", "invoke-issued", "provider-get", "ratchet-persisted", "ratchet-held",
      "ratchet-prepared", "ratchet-invalidated-old", "ratchet-committed", "ratchet-published",
      "release-authorized",
      "released", "evidence", "terminal-begun", "destroy:completed", "terminal-committed",
    ]);
    expect(test.state).toMatchObject({lifecycle: "completed", taskGeneration: 2});
    await expect(test.invokeOld()).rejects.toThrow("generations are stale");
  });

  it("fails closed on a stale release acknowledgement and supports every terminal outcome", async () => {
    const failed = makeHarness();
    failed.badReleaseAck = true;
    await expect(failed.workflow.run(input)).rejects.toThrow("release acknowledgement");
    expect(failed.state.lifecycle).toBe("failed");
    expect(failed.order).toContain("destroy:failed");

    for (const outcome of ["cancelled", "failed", "expired"] as const) {
      const test = makeHarness();
      await test.workflow.terminate("task-1", outcome);
      expect(test.state.lifecycle).toBe(outcome);
    }
  });

  it("observes durable cancellation before release and resumes terminal commit", async () => {
    const cancelled = makeHarness();
    cancelled.cancelOnRatchet = true;
    await expect(cancelled.workflow.run(input)).rejects.toThrow("cancellation became effective");
    expect(cancelled.order).not.toContain("released");
    expect(cancelled.state.lifecycle).toBe("cancelled");

    const raced = makeHarness();
    raced.cancelAfterAuthorize = true;
    await expect(raced.workflow.run(input)).rejects.toThrow("stale before delivery");
    expect(raced.order).not.toContain("released");

    const recovered = makeHarness();
    recovered.failTerminalCommit = true;
    await expect(recovered.workflow.terminate("task-1", "expired", "terminal-recovery"))
      .rejects.toThrow("commit unavailable");
    recovered.failTerminalCommit = false;
    await recovered.workflow.terminate("task-1", "expired", "terminal-recovery");
    expect(recovered.order.filter(step => step === "destroy:expired")).toHaveLength(2);
    expect(recovered.state.lifecycle).toBe("expired");
  });
});
