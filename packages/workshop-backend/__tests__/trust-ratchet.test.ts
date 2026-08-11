import {describe, expect, it} from "vitest";

import {
  TrustRatchet,
  type RatchetBindingAuthority,
  type RatchetEnvironmentSnapshot,
  type RatchetEndpointAcknowledgement,
  type TrustRatchetHost,
  type TrustRatchetTransition,
} from "../src/authority/trust-ratchet.js";

const parentBinding: RatchetBindingAuthority = {
  name: "R2_STORAGE",
  requirementId: "requirement-r2",
  bindingId: "binding-1",
  bindingGeneration: 1,
  contractInstanceId: "instance-1",
  contractInstanceGeneration: 1,
  authority: {
    provider: "cloudflare-r2",
    resourceIdentity: "bucket/prefix",
    upstreamAuthorityIdentity: "source-1:1",
    artifactApprovalId: "approval-1",
    artifactApprovalEpoch: 1,
    operations: ["get", "list", "put"],
    recipients: ["agentModel"],
    egress: [],
    releaseClasses: ["r2Object", "r2List", "r2WriteReceipt"],
    sharing: "isolated",
    enforcementProfile: "r2-task-v1",
    maximumExpiresAt: 50_000,
  },
};

const replacement: RatchetBindingAuthority = {
  ...parentBinding,
  bindingId: "binding-2",
  contractInstanceId: "instance-2",
  authority: {
    ...parentBinding.authority,
    operations: ["get"],
    releaseClasses: ["r2Object"],
    maximumExpiresAt: 40_000,
  },
};

function environment(): RatchetEnvironmentSnapshot {
  return {
    taskId: "task-1",
    taskActive: true,
    taskGeneration: 1,
    leaseGeneration: 1,
    generation: 1,
    ratchetVersion: 1,
    leaseExpiresAt: 45_000,
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
}

function acknowledgement(
  transition: TrustRatchetTransition,
  binding: RatchetBindingAuthority,
  state: RatchetEndpointAcknowledgement["state"],
): RatchetEndpointAcknowledgement {
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
    state,
  };
}

function harness() {
  let current = environment();
  const order: string[] = [];
  let releaseAllowed = true;
  let failInvalidation = false;
  let failPublication = false;
  const intents = new Map<string, string>();
  const transitions = new Map<string, {transition: TrustRatchetTransition; state: "pending" | "committed";
    environment?: RatchetEnvironmentSnapshot}>();
  const host: TrustRatchetHost = {
    readTransition(id) {
      return transitions.get(id);
    },
    readCurrent: () => structuredClone(current),
    async holdProtectedResults() {
      releaseAllowed = false;
      order.push("hold");
    },
    async persistTransition(transition) {
      const value = JSON.stringify(transition);
      const previous = intents.get(transition.id);
      if (previous && previous !== value) throw new Error("non-exact replay");
      intents.set(transition.id, value);
      transitions.set(transition.id, {transition: structuredClone(transition), state: "pending"});
      order.push("persist");
    },
    async prepareBinding(transition, binding) {
      order.push("prepare");
      return acknowledgement(transition, binding, "prepared");
    },
    async invalidatePredecessor(transition, binding) {
      order.push("invalidate");
      if (failInvalidation) throw new Error("invalidation unavailable");
      return acknowledgement(transition, binding, "invalidated");
    },
    async commitTransition(transition) {
      order.push("commit");
      current = {
        ...current,
        generation: transition.nextEnvironmentGeneration,
        ratchetVersion: transition.nextRatchetVersion,
        leaseExpiresAt: transition.nextExpiresAt,
        bindings: transition.changes.flatMap(change =>
          change.type === "retain" ? [parentBinding] :
            change.type === "replace" ? [change.replacement] : []),
        permanentlyRemoved: transition.permanentlyRemoved,
      };
      transitions.set(transition.id, {
        transition: structuredClone(transition),
        state: "committed",
        environment: structuredClone(current),
      });
      return structuredClone(current);
    },
    async publishEnvironment(transition, next) {
      order.push("publish");
      if (failPublication) throw new Error("publication unavailable");
      releaseAllowed = true;
      return {
        transitionId: transition.id,
        taskId: transition.taskId,
        taskGeneration: transition.taskGeneration,
        leaseGeneration: transition.leaseGeneration,
        environmentGeneration: transition.nextEnvironmentGeneration,
        ratchetVersion: transition.nextRatchetVersion,
        bindings: next.bindings.map(binding => ({
          bindingId: binding.bindingId,
          bindingGeneration: binding.bindingGeneration,
          contractInstanceId: binding.contractInstanceId,
          contractInstanceGeneration: binding.contractInstanceGeneration,
        })),
      };
    },
  };
  return {
    ratchet: new TrustRatchet(host),
    order,
    get releaseAllowed() { return releaseAllowed; },
    set failInvalidation(value: boolean) { failInvalidation = value; },
    set failPublication(value: boolean) { failPublication = value; },
    makeTerminal() { current = {...current, taskActive: false}; },
  };
}

describe("Trust Ratchet", () => {
  it("publishes a lineage-linked narrower environment only after invalidation", async () => {
    const test = harness();
    const next = await test.ratchet.transition({
      transitionId: "transition-1",
      taskId: "task-1",
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      expectedRatchetVersion: 1,
      nextExpiresAt: 40_000,
      changes: [{type: "replace", bindingId: "binding-1", replacement}],
    });
    expect(next).toMatchObject({generation: 2, ratchetVersion: 2, leaseExpiresAt: 40_000});
    expect(test.order).toEqual(["persist", "hold", "prepare", "invalidate", "commit", "publish"]);
    expect(test.releaseAllowed).toBe(true);
  });

  it("rejects broader authority and holds protected data across invalidation failure", async () => {
    const broader = {
      ...replacement,
      authority: {...replacement.authority, operations: ["get", "delete"]},
    };
    await expect(harness().ratchet.transition({
      transitionId: "transition-broader",
      taskId: "task-1",
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      expectedRatchetVersion: 1,
      nextExpiresAt: 40_000,
      changes: [{type: "replace", bindingId: "binding-1", replacement: broader}],
    })).rejects.toThrow("subset");

    const failed = harness();
    failed.failInvalidation = true;
    await expect(failed.ratchet.transition({
      transitionId: "transition-crash",
      taskId: "task-1",
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      expectedRatchetVersion: 1,
      nextExpiresAt: 40_000,
      changes: [{type: "replace", bindingId: "binding-1", replacement}],
    })).rejects.toThrow("invalidation");
    expect(failed.releaseAllowed).toBe(false);
    expect(failed.order).not.toContain("commit");
    expect(failed.order).not.toContain("publish");
  });

  it("resumes publication after a crash following canonical commit", async () => {
    const test = harness();
    test.failPublication = true;
    const input = {
      transitionId: "transition-recovery",
      taskId: "task-1",
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      expectedRatchetVersion: 1,
      nextExpiresAt: 40_000,
      changes: [{type: "replace" as const, bindingId: "binding-1", replacement}],
    };
    await expect(test.ratchet.transition(input)).rejects.toThrow("publication");
    expect(test.releaseAllowed).toBe(false);
    test.failPublication = false;
    await expect(test.ratchet.transition(input)).resolves.toMatchObject({
      generation: 2,
      ratchetVersion: 2,
    });
    expect(test.releaseAllowed).toBe(true);
    expect(test.order.filter(step => step === "commit")).toHaveLength(1);
  });

  it("never republishes a committed environment after the task becomes terminal", async () => {
    const test = harness();
    test.failPublication = true;
    const input = {
      transitionId: "transition-obsolete",
      taskId: "task-1",
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      expectedRatchetVersion: 1,
      nextExpiresAt: 40_000,
      changes: [{type: "replace" as const, bindingId: "binding-1", replacement}],
    };
    await expect(test.ratchet.transition(input)).rejects.toThrow("publication");
    test.failPublication = false;
    test.makeTerminal();
    await expect(test.ratchet.transition(input)).rejects.toThrow("obsolete");
    expect(test.releaseAllowed).toBe(false);
  });

  it("permits consecutive expiry-only narrowing without restoring removed authority", async () => {
    const test = harness();
    const first = {
      ...parentBinding,
      bindingId: "binding-expiry-1",
      contractInstanceId: "instance-expiry-1",
      authority: {...parentBinding.authority, maximumExpiresAt: 40_000},
    };
    await test.ratchet.transition({
      transitionId: "transition-expiry-1",
      taskId: "task-1",
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      expectedRatchetVersion: 1,
      nextExpiresAt: 40_000,
      changes: [{type: "replace", bindingId: "binding-1", replacement: first}],
    });
    const second = {
      ...first,
      bindingId: "binding-expiry-2",
      contractInstanceId: "instance-expiry-2",
      authority: {...first.authority, maximumExpiresAt: 30_000},
    };
    await expect(test.ratchet.transition({
      transitionId: "transition-expiry-2",
      taskId: "task-1",
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 2,
      expectedRatchetVersion: 2,
      nextExpiresAt: 30_000,
      changes: [{type: "replace", bindingId: first.bindingId, replacement: second}],
    })).resolves.toMatchObject({generation: 3, ratchetVersion: 3, leaseExpiresAt: 30_000});
  });
});
