import {describe, expect, it} from "vitest";

import {
  AgentTaskMediator,
  type AgentActivityRecord,
  type AgentTaskExecutionSnapshot,
  type AgentTaskMediatorHost,
  type ProtectedTaskResultReference,
  type TaskCancellationCompanion,
  type TaskInvocationAcknowledgement,
  type TaskInvocationEnvelope,
} from "../src/authority/agent-task-mediator.js";
import type {
  AgentTaskId,
  ArtifactApprovalId,
  BindingId,
  BindingResolutionId,
  ConsumerId,
  ContractInstanceId,
  RequirementId,
  SourceId,
  TaskDispatchDecisionId,
  TaskTemplateApprovalId,
  TaskTemplateId,
} from "../src/authority/records.js";

function id<T extends string>(value: string): T {
  return value as T;
}

class TestCancellation implements TaskCancellationCompanion {
  cancelled = false;
  callbacks = new Set<() => void>();

  constructor(readonly id: string, readonly generation: number) {}

  throwIfCancelled(): void {
    if (this.cancelled) throw new Error("Agent Task invocation cancelled.");
  }

  onCancel(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  cancel(): void {
    this.cancelled = true;
    for (const callback of this.callbacks) callback();
  }
}

function makeSnapshot(now: number): AgentTaskExecutionSnapshot {
  const taskId = id<AgentTaskId>("task-1");
  const consumerId = id<ConsumerId>("consumer-task-1");
  const bindingId = id<BindingId>("binding-task-1");
  const resolutionId = id<BindingResolutionId>("resolution-task-1");
  const instanceId = id<ContractInstanceId>("instance-task-1");
  const requirementId = id<RequirementId>("requirement-r2");
  const artifactApprovalId = id<ArtifactApprovalId>("approval-r2");
  const taskTemplateId = id<TaskTemplateId>("template-r2");
  const dispatchDecisionId = id<TaskDispatchDecisionId>("dispatch-1");
  const templateApprovalId = id<TaskTemplateApprovalId>("template-approval-1");
  const sourceId = id<SourceId>("source-r2");
  const correlation = {
    taskId,
    taskGeneration: 1,
    principal: {id: "principal-1", generation: 3},
    actorChain: [
      {type: "workspacePrincipal" as const, id: "principal-1", generation: 3},
      {type: "agentServiceWorkload" as const, id: "workload-1", generation: 2},
    ],
  };
  const upstreamBinding = {
    name: "R2_STORAGE",
    bindingId: id<BindingId>("standing-binding-r2"),
    bindingGeneration: 4,
    contractInstanceId: id<ContractInstanceId>("standing-instance-r2"),
    contractInstanceGeneration: 2,
  };
  const requirement = {
    type: "taskTemplate" as const,
    taskTemplateId,
    taskTemplateVersion: 1,
    requirementId,
  };
  const consumer = {
    type: "agentTask" as const,
    consumerId,
    taskId,
    taskGeneration: 1,
  };
  return {
    task: {
      id: taskId,
      consumerId,
      generation: 1,
      dispatchDecisionId,
      templateApprovalId,
      agentServiceProfileId: "agent-service-1",
      agentServiceProfileGeneration: 2,
      correlation,
      intentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: now - 1_000,
      absoluteExpiresAt: now + 60_000,
      leaseGeneration: 1,
      leaseExpiresAt: now + 30_000,
      environmentGeneration: 1,
      ratchetVersion: 1,
      lifecycle: "running",
    },
    environment: {
      id: "task-environment-1",
      taskId,
      taskGeneration: 1,
      generation: 1,
      ratchetVersion: 1,
      leaseGeneration: 1,
      leaseExpiresAt: now + 30_000,
      absoluteExpiresAt: now + 60_000,
      correlation,
      effectiveAuthorityDigest: `sha256:${"2".repeat(64)}`,
      bindings: [{
        name: "R2_STORAGE",
        required: true,
        requirementId,
        resolutionId,
        contractInstanceId: instanceId,
        bindingId,
        upstreamBinding,
      }],
      omittedOptionalRequirements: [],
      state: "ready",
    },
    binding: {
      id: bindingId,
      consumer,
      name: "R2_STORAGE",
      requirement,
      contractInstanceId: instanceId,
      resolutionId,
      status: "active",
      generation: 1,
      revision: 2,
      installedSequence: 10,
    },
    resolution: {
      id: resolutionId,
      consumer,
      requirement,
      upstreamAuthority: {
        sourceId,
        sourceGeneration: 2,
        origin: {type: "workspaceAccount", id: "account-1", generation: 3},
      },
      verification: {type: "notRequired"},
      artifactApprovalId,
      artifactApprovalEpoch: 1,
      placementDecision: {type: "taskDispatch", decisionId: dispatchDecisionId},
      contractInstanceId: instanceId,
      bindingId,
      sharedState: {type: "isolated"},
      expectedBindingGeneration: 0,
      evaluatorPolicyHash: `sha256:${"3".repeat(64)}`,
      upstreamBinding,
      createdSequence: 9,
    },
    instance: {
      id: instanceId,
      artifactApprovalId,
      artifactHash: `sha256:${"4".repeat(64)}`,
      runtimeProfileHash: `sha256:${"5".repeat(64)}`,
      upstreamAuthority: {
        sourceId,
        sourceGeneration: 2,
        origin: {type: "workspaceAccount", id: "account-1", generation: 3},
      },
      providerBacking: {
        provider: {
          providerId: "cloudflare-r2",
          accountId: "account-1",
          sourceId: "provider-source-1",
          sourceGeneration: 2,
        },
        backingReference: "opaque-task-backing",
        capabilityGeneration: 7,
        providerNativeScope: {
          resources: ["bucket-1"],
          operations: ["head", "get", "list", "put", "delete"],
          recipients: [],
          egress: [],
        },
        providerNativeRevocationGranularity: "deployment-resource",
        localEnforcementRevocationGranularity: "contract-instance-backing",
      },
      placementDecision: {type: "taskDispatch", decisionId: dispatchDecisionId},
      intendedConsumer: consumer,
      intendedRequirement: requirement,
      sharedState: {type: "isolated"},
      lifecycle: "ready",
      generation: 1,
      revision: 2,
      createdSequence: 9,
    },
    artifactApprovalEpoch: 1,
    providerCapabilityGeneration: 7,
    publicTypes: "export interface R2Storage { get(key: string): Promise<Uint8Array | null> }",
    cancellation: {id: "task-cancellation-1", generation: 1},
    effectiveAuthority: {
      provider: "cloudflare-r2",
      resources: ["approved-prefix"],
      operations: ["head", "get", "list", "put", "delete"],
      resultClasses: ["r2Metadata", "r2Object", "r2List", "r2WriteReceipt"],
      recipients: ["agentModel"],
      egress: [],
      maximumExpiresAt: now + 60_000,
    },
  };
}

function makeHarness(now = 10_000) {
  let snapshot = makeSnapshot(now);
  const activities: AgentActivityRecord[] = [];
  const protectedValues = new Map<string, unknown>();
  const dynamicWorkers: unknown[] = [];
  const invocationReceipts = new Map<string, TaskInvocationAcknowledgement>();
  const claimedInvocations = new Set<string>();
  const releasedResults = new Set<string>();
  let invokeCount = 0;
  const host: AgentTaskMediatorHost = {
    readSnapshot(taskId, bindingName) {
      if (taskId !== snapshot.task.id) return undefined;
      if (bindingName && bindingName !== snapshot.binding.name) return undefined;
      return structuredClone(snapshot);
    },
    async protectResult(envelope, value) {
      const reference: ProtectedTaskResultReference = {
        id: `protected-${protectedValues.size + 1}`,
        contentHash: `sha256:${"a".repeat(64)}`,
        size: JSON.stringify(value).length,
        invocationId: envelope.invocationId,
        taskEnvironmentGeneration: envelope.taskEnvironmentGeneration,
        ratchetVersion: envelope.ratchetVersion,
        bindingGeneration: envelope.bindingGeneration,
      };
      protectedValues.set(reference.id, structuredClone(value));
      return reference;
    },
    async releaseResult(_envelope, reference) {
      const firstRelease = !releasedResults.has(reference.id);
      releasedResults.add(reference.id);
      return {value: structuredClone(protectedValues.get(reference.id)), firstRelease};
    },
    authorizeRelease(envelope, reference) {
      return envelope.invocationId === reference.invocationId;
    },
    claimInvocation(envelope) {
      const acknowledgement = invocationReceipts.get(envelope.invocationId);
      if (acknowledgement) {
        return {state: "completed", acknowledgement: structuredClone(acknowledgement)};
      }
      if (claimedInvocations.has(envelope.invocationId)) return {state: "inProgress"};
      claimedInvocations.add(envelope.invocationId);
      return {state: "claimed"};
    },
    completeInvocation(envelope, acknowledgement) {
      invocationReceipts.set(envelope.invocationId, structuredClone(acknowledgement));
    },
    recordActivity(record) {
      activities.push(structuredClone(record));
    },
    async invokeR2(_envelope, cancellation) {
      invokeCount++;
      cancellation.throwIfCancelled();
      return {value: {body: "protected-r2-value"}, sourceActivityId: "source-activity-1"};
    },
    openTaskBinding(exact) {
      return {bindingId: exact.binding.id, generation: exact.binding.generation};
    },
    async runDynamicWorker(input) {
      dynamicWorkers.push(input);
      input.cancellation.throwIfCancelled();
      return "worker-complete";
    },
    async giveUp(taskId, expectedGeneration) {
      if (taskId !== snapshot.task.id || expectedGeneration !== snapshot.task.generation) {
        throw new Error("stale task");
      }
      snapshot = {...snapshot, task: {...snapshot.task, lifecycle: "failed", generation: 2}};
    },
  };
  return {
    mediator: new AgentTaskMediator(host, () => now),
    get snapshot() { return snapshot; },
    set snapshot(value: AgentTaskExecutionSnapshot) { snapshot = value; },
    activities,
    protectedValues,
    dynamicWorkers,
    get invokeCount() { return invokeCount; },
  };
}

function envelopeAndCancellation(harness: ReturnType<typeof makeHarness>): {
  envelope: TaskInvocationEnvelope;
  cancellation: TestCancellation;
} {
  const envelope = harness.mediator.createInvocation({
    taskId: harness.snapshot.task.id,
    bindingName: "R2_STORAGE",
    operation: "get",
    resource: "approved-prefix/file.txt",
    resultClass: "r2Object",
    requestedDeadline: harness.snapshot.task.leaseExpiresAt,
  });
  return {
    envelope,
    cancellation: new TestCancellation(
      envelope.cancellationId,
      envelope.cancellationGeneration,
    ),
  };
}

describe("Agent Task R2 mediator", () => {
  it("buffers R2 observations until exact generation-checked release", async () => {
    const harness = makeHarness();
    const {envelope, cancellation} = envelopeAndCancellation(harness);
    expect(Object.values(envelope).some(value => typeof value === "function")).toBe(false);

    const acknowledgement = await harness.mediator.invoke(
      envelope,
      cancellation,
      [envelope.resource],
    );
    expect(acknowledgement).toMatchObject({
      outcome: "completed",
      acknowledgementGeneration: 1,
      protectedResult: {invocationId: envelope.invocationId},
    });
    expect(harness.invokeCount).toBe(1);
    expect(await harness.mediator.invoke(envelope, cancellation, [envelope.resource]))
      .toEqual(acknowledgement);
    expect(harness.invokeCount).toBe(1);
    expect(harness.protectedValues.size).toBe(1);
    expect(await harness.mediator.release(envelope, acknowledgement))
      .toEqual({body: "protected-r2-value"});
    expect(await harness.mediator.release(envelope, acknowledgement))
      .toEqual({body: "protected-r2-value"});
    expect(harness.activities.map(activity => activity.type)).toEqual([
      "invocationIssued",
      "sourceAttempted",
      "resultProtected",
      "releaseAcknowledged",
    ]);
  });

  it("rejects stale release, cancellation, and unsupported asynchronous results", async () => {
    const harness = makeHarness();
    const {envelope, cancellation} = envelopeAndCancellation(harness);
    cancellation.cancel();
    await expect(harness.mediator.invoke(envelope, cancellation, [])).rejects.toThrow("cancelled");
    expect(harness.invokeCount).toBe(0);

    const current = envelopeAndCancellation(harness);
    const acknowledgement = await harness.mediator.invoke(
      current.envelope,
      current.cancellation,
      [current.envelope.resource],
    );
    harness.snapshot = {
      ...harness.snapshot,
      task: {...harness.snapshot.task, environmentGeneration: 2},
      environment: {...harness.snapshot.environment, generation: 2},
    };
    await expect(harness.mediator.release(current.envelope, acknowledgement))
      .rejects.toThrow("stale");

    const rotated = makeHarness();
    const rotatedInvocation = envelopeAndCancellation(rotated);
    rotated.snapshot = {
      ...rotated.snapshot,
      cancellation: {id: "task-cancellation-2", generation: 2},
    };
    await expect(rotated.mediator.invoke(
      rotatedInvocation.envelope,
      rotatedInvocation.cancellation,
      [rotatedInvocation.envelope.resource],
    )).rejects.toThrow("stale");

    const raw = makeHarness();
    raw.mediator.host.invokeR2 = async () => ({
      value: {async *[Symbol.asyncIterator]() { yield "raw"; }},
    });
    const rawInvocation = envelopeAndCancellation(raw);
    await expect(raw.mediator.invoke(rawInvocation.envelope, rawInvocation.cancellation,
      [rawInvocation.envelope.resource]))
      .resolves.toMatchObject({outcome: "failed"});
  });

  it("propagates cancellation into in-flight provider work", async () => {
    const harness = makeHarness();
    harness.mediator.host.invokeR2 = (_envelope, cancellation) => new Promise((_, reject) => {
      cancellation.onCancel(() => reject(new Error("provider invocation cancelled")));
    });
    const invocation = envelopeAndCancellation(harness);
    const pending = harness.mediator.invoke(
      invocation.envelope,
      invocation.cancellation,
      [invocation.envelope.resource],
    );
    invocation.cancellation.cancel();
    await expect(pending).resolves.toMatchObject({outcome: "cancelled"});
  });

  it("runs only the closed task tool surface with no ambient bindings or network", async () => {
    const harness = makeHarness();
    const cancellation = new TestCancellation("task-cancellation-1", 1);
    expect(harness.mediator.getHostToolCatalog()).toEqual([
      "executeCode",
      "describeBinding",
      "giveUp",
    ]);
    expect(harness.mediator.describeBinding(harness.snapshot.task.id, "R2_STORAGE"))
      .toContain("interface R2Storage");
    await expect(harness.mediator.executeCode(
      harness.snapshot.task.id,
      "export default async ({env}) => env.R2_STORAGE.get('key')",
      cancellation,
    )).resolves.toBe("worker-complete");
    expect(harness.dynamicWorkers).toHaveLength(1);
    expect(harness.dynamicWorkers[0]).toMatchObject({
      globalOutbound: null,
      bindings: {R2_STORAGE: {publicTypes: expect.stringContaining("R2Storage")}},
    });
    expect(() => harness.mediator.rejectUnsupportedTool("webFetch"))
      .toThrow("unavailable");
    await harness.mediator.giveUp(harness.snapshot.task.id, 1);
    expect(harness.snapshot.task.lifecycle).toBe("failed");
  });
});
