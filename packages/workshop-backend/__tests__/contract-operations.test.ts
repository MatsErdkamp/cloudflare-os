import { describe, expect, it, vi } from "vitest";
import { env, RpcTarget } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";

import type { OverseerDurableObject } from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const DESCRIPTION = {title: "Publish", description: "Publish the reviewed change"};

function contractCall() {
  return {
    callId: "call-7",
    contractId: 70,
    artifactHash: "sha256:artifact",
    sourceGatekeeperId: 17,
    caller: {from: "gadget", gadgetId: 9},
    startedAt: new Date(0),
    methodName: "publish",
  };
}

describe("Contract Source actions and operations", () => {
  it("auto-applies Contract actions with attribution while direct Source actions stay pending", async () => {
    const applied: number[] = [];
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-preapproved-actions"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        impl.getGatekeeperFacet = () => ({
          applyAction: async (action: number) => { applied.push(action); },
        });

        await impl.submitContractAction(
          contractCall(), {type: "preapproved"}, 41, DESCRIPTION,
        );
        await vi.waitFor(() => expect(applied).toEqual([41]));

        const contractAction = [...impl.storage.actions.list()][0];
        expect(contractAction).toMatchObject({
          type: "action",
          state: "approved",
          contractPreapproved: true,
          contractAttribution: {
            contractId: 70,
            artifactHash: "sha256:artifact",
            contractCallId: "call-7",
            contractMethod: "publish",
          },
        });

        await impl.submitAction(17, 42, DESCRIPTION, {from: "user"});
        const directAction = [...impl.storage.actions.list()][1];
        expect(directAction).toMatchObject({type: "action", state: "pending", action: 42});
        expect(directAction.contractAttribution).toBeUndefined();
        expect(applied).toEqual([41]);
      },
    );
  });

  it("surfaces a preapproved action for retry when deferred provider application fails", async () => {
    let attempts = 0;
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-preapproved-action-failure"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        impl.getGatekeeperFacet = () => ({
          applyAction: async () => {
            attempts += 1;
            throw new Error("provider unavailable");
          },
        });

        await impl.submitContractAction(
          contractCall(), {type: "preapproved"}, 43, DESCRIPTION,
        );
        await vi.waitFor(() => expect([...impl.storage.actions.list()][0])
          .toMatchObject({contractApplyFailed: true}));
        expect(attempts).toBe(1);

        expect([...impl.storage.actions.list()][0]).toMatchObject({
          type: "action",
          state: "pending",
          contractPreapproved: true,
          contractApplyFailed: true,
          contractAttribution: {
            contractId: 70,
            contractCallId: "call-7",
          },
        });
      },
    );
  });

  it("shares only structured opted-in state and preserves it when one instance is deleted", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-shared-state"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        await impl.putContractSharedState("team", "release", {version: 3});
        await expect(impl.getContractSharedState("team", "release"))
          .resolves.toEqual({version: 3});
        await expect(impl.getContractSharedState("other", "release"))
          .resolves.toBeUndefined();
        await expect(impl.putContractSharedState(
          "team", "capability", new class extends RpcTarget { read() {} }(),
        )).rejects.toThrow("structured data");

        impl.storage.contracts.put({
          id: 70,
          artifactHash: "sha256:artifact",
          runtimeHarnessVersion: "5",
          sourceGatekeeperId: 17,
          title: "Contract",
          publicTypes: "export interface ContractBinding {}",
          createdAt: new Date(0),
          approvedBy: "admin",
          sharedStateKey: "team",
        });
        await impl.deleteContract(70);
        await expect(impl.getContractSharedState("team", "release"))
          .resolves.toEqual({version: 3});
      },
    );
  });

  it("groups staged children under one operation and applies or rejects them in order", async () => {
    const applied: number[] = [];
    const rejected: number[] = [];
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-manual-operation"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        impl.getGatekeeperFacet = () => ({
          applyAction: async (action: number) => { applied.push(action); },
          rejectAction: async (action: number) => { rejected.push(action); },
        });
        const putOperation = (id: string) => impl.storage.contractOperations.put({
          id,
          contractId: 70,
          artifactHash: "sha256:artifact",
          caller: {from: "gadget", gadgetId: 9},
          title: "Publish",
          description: "Publish release",
          state: "pending",
          childActionIds: [],
          createdAt: new Date(0),
        });

        putOperation("approve-parent");
        await impl.submitContractAction(
          contractCall(), {type: "manual", operationId: "approve-parent"}, 1, DESCRIPTION,
        );
        await impl.submitContractAction(
          contractCall(), {type: "manual", operationId: "approve-parent"}, 2, DESCRIPTION,
        );
        expect(applied).toEqual([]);
        expect(impl.storage.contractOperations.get("approve-parent").childActionIds)
          .toEqual([0, 1]);
        expect(() => impl.assertContractChildNotIndividuallyDecidable(
          impl.storage.actions.get(0),
        )).toThrow("parent operation");

        await impl.approveContractOperation("approve-parent");
        expect(applied).toEqual([1, 2]);
        expect(impl.storage.contractOperations.get("approve-parent").state).toBe("applied");

        putOperation("reject-parent");
        await impl.submitContractAction(
          contractCall(), {type: "manual", operationId: "reject-parent"}, 3, DESCRIPTION,
        );
        await impl.rejectContractOperation("reject-parent");
        expect(rejected).toEqual([3]);
        expect(impl.storage.contractOperations.get("reject-parent").state).toBe("rejected");
      },
    );
  });

  it("records the actual child outcomes when ordered application partially fails", async () => {
    const rejected: number[] = [];
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-partial-operation"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        impl.getGatekeeperFacet = () => ({
          applyAction: async (action: number) => {
            if (action === 2) throw new Error("provider failed");
          },
          rejectAction: async (action: number) => { rejected.push(action); },
        });
        impl.storage.contractOperations.put({
          id: "partial-parent",
          contractId: 70,
          artifactHash: "sha256:artifact",
          caller: {from: "gadget", gadgetId: 9},
          title: "Publish",
          description: "Publish in order",
          state: "pending",
          childActionIds: [],
          createdAt: new Date(0),
        });
        for (const action of [1, 2, 3]) {
          await impl.submitContractAction(
            contractCall(), {type: "manual", operationId: "partial-parent"}, action, DESCRIPTION,
          );
        }

        await expect(impl.approveContractOperation("partial-parent"))
          .rejects.toThrow("provider failed");

        expect(impl.storage.contractOperations.get("partial-parent").state).toBe("failed");
        expect([...impl.storage.actions.list()].map((action: any) => action.state))
          .toEqual(["approved", "rejected", "rejected"]);
        expect(rejected).toEqual([2, 3]);
      },
    );
  });

  it("creates retryable generic requirements and records both decisions", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-require-operation"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        const first = {...DESCRIPTION, key: "read:secret"};
        expect(() => impl.requireContractApproval(contractCall(), first))
          .toThrowError(expect.objectContaining({name: "ContractApprovalRequired"}));
        const pending = [...impl.storage.contractOperations.list()][0];
        expect(pending).toMatchObject({state: "pending", approvalKey: "read:secret"});

        await impl.approveContractOperation(pending.id);
        expect(() => impl.requireContractApproval(contractCall(), first)).not.toThrow();

        const second = {...DESCRIPTION, key: "read:other"};
        expect(() => impl.requireContractApproval(contractCall(), second))
          .toThrowError(expect.objectContaining({name: "ContractApprovalRequired"}));
        const other = [...impl.storage.contractOperations.list()]
          .find((operation: any) => operation.approvalKey === "read:other");
        await impl.rejectContractOperation(other.id);
        expect(() => impl.requireContractApproval(contractCall(), second))
          .toThrowError(expect.objectContaining({name: "ContractApprovalRejected"}));
      },
    );
  });

  it("disables Contract-owned hooks and rejects stale delivery after deletion", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-hook-deletion"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        const hookId = "contract-hook-controller";
        const controller = impl.ctx.exports.HookLifecycleTestTarget({props: {id: hookId}});
        const callback = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "callback"}});
        impl.storage.contracts.put({
          id: 70,
          artifactHash: "sha256:artifact",
          runtimeHarnessVersion: "5",
          sourceGatekeeperId: 17,
          title: "Contract",
          publicTypes: "export interface ContractBinding {}",
          createdAt: new Date(0),
          approvedBy: "admin",
        });
        impl.storage.boundHooks.put({
          id: 4,
          actionId: 9,
          gatekeeperId: 17,
          contractId: 70,
          controller,
          callback,
          description: {title: "Incoming email", description: "Contract callback"},
          enabled: true,
        });
        impl.storage.actions.put({
          id: 9,
          gatekeeperId: 17,
          caller: {from: "hook"},
          createdAt: new Date(0),
          state: "approved",
          type: "bindHook",
          hookId: 4,
          description: {title: "Incoming email", description: "Contract callback"},
          enabled: true,
        });

        await impl.deleteContract(70);

        const controllerAfter = impl.ctx.exports.HookLifecycleTestTarget({props: {id: hookId}});
        await expect(controllerAfter.disabledCount()).resolves.toBe(1);
        expect(impl.storage.boundHooks.get(4)).toBeUndefined();
        expect(impl.storage.actions.get(9)).toMatchObject({enabled: false});
        expect(impl.storage.actions.get(9).hookId).toBeUndefined();
        expect(impl.storage.contracts.get(70)).toBeUndefined();
        expect(impl.storage.contractTombstones.get(70)).toBeDefined();
        await expect(instance.startHook(4)).rejects.toThrow("deleted or disabled");
      },
    );
  });

  it("does not resurrect a Contract hook when deletion races provider enablement", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-hook-enable-deletion-race"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        const controller = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "enable-race"}});
        const callback = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "enable-race-callback"}});
        impl.storage.contracts.put({
          id: 70,
          artifactHash: "sha256:artifact",
          runtimeHarnessVersion: "7",
          sourceGatekeeperId: 17,
          title: "Contract",
          publicTypes: "export interface ContractBinding {}",
          createdAt: new Date(0),
          approvedBy: "admin",
        });
        impl.storage.boundHooks.put({
          id: 4,
          actionId: 9,
          gatekeeperId: 17,
          contractId: 70,
          controller,
          callback,
          description: {title: "Incoming email", description: "Contract callback"},
          enabled: false,
        });
        impl.storage.actions.put({
          id: 9,
          gatekeeperId: 17,
          caller: {from: "hook"},
          createdAt: new Date(0),
          state: "approved",
          type: "bindHook",
          hookId: 4,
          description: {title: "Incoming email", description: "Contract callback"},
          enabled: false,
        });
        await controller.pauseEnable();

        const enabling = impl.enableContractHook(4);
        await vi.waitFor(async () => {
          expect(await controller.enableStartedCount()).toBe(1);
        });
        await impl.deleteContract(70);
        await controller.releaseEnable();
        await enabling;

        expect(impl.storage.boundHooks.get(4)).toBeUndefined();
        expect(impl.storage.contracts.get(70)).toBeUndefined();
        await expect(controller.enabledCount()).resolves.toBe(1);
        await expect(controller.disabledCount()).resolves.toBe(1);
      },
    );
  });

  it("stages Contract hook registration inside a manual parent operation", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-manual-hook"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        const call = contractCall();
        const controller = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "manual-hook"}});
        const callback = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "manual-callback"}});
        impl.storage.contracts.put({
          id: call.contractId,
          artifactHash: call.artifactHash,
          runtimeHarnessVersion: "7",
          sourceGatekeeperId: call.sourceGatekeeperId,
          title: "Contract",
          publicTypes: "export interface ContractBinding {}",
          createdAt: new Date(0),
          approvedBy: "admin",
        });
        impl.storage.contractOperations.put({
          id: "manual-hook-parent",
          contractId: call.contractId,
          artifactHash: call.artifactHash,
          caller: call.caller,
          title: "Install callback",
          description: "Install only after approval",
          state: "pending",
          childActionIds: [],
          createdAt: new Date(0),
        });

        await impl.bindHook(
          call.sourceGatekeeperId,
          controller,
          callback,
          {title: "Incoming event", description: "Contract callback"},
          call.caller,
          call,
          {type: "manual", operationId: "manual-hook-parent"},
        );

        const action = [...impl.storage.actions.list()][0];
        const hook = [...impl.storage.boundHooks.list()][0];
        expect(action).toMatchObject({
          state: "pending",
          type: "bindHook",
          enabled: false,
          contractAttribution: {contractOperationId: "manual-hook-parent"},
        });
        expect(impl.storage.contractOperations.get("manual-hook-parent").childActionIds)
          .toEqual([action.id]);
        await expect(controller.enabledCount()).resolves.toBe(0);

        await impl.approveContractOperation("manual-hook-parent");

        await expect(controller.enabledCount()).resolves.toBe(1);
        expect(impl.storage.boundHooks.get(hook.id)).toMatchObject({enabled: true});
        expect(impl.storage.actions.get(action.id)).toMatchObject({state: "approved", enabled: true});
      },
    );
  });

  it("removes a staged Contract hook when its parent operation is rejected", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-rejected-hook"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        const call = contractCall();
        const controller = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "rejected-hook"}});
        const callback = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "rejected-callback"}});
        impl.storage.contractOperations.put({
          id: "rejected-hook-parent",
          contractId: call.contractId,
          artifactHash: call.artifactHash,
          caller: call.caller,
          title: "Install callback",
          description: "Reject callback",
          state: "pending",
          childActionIds: [],
          createdAt: new Date(0),
        });
        await impl.bindHook(
          call.sourceGatekeeperId,
          controller,
          callback,
          {title: "Incoming event", description: "Contract callback"},
          call.caller,
          call,
          {type: "manual", operationId: "rejected-hook-parent"},
        );
        const action = [...impl.storage.actions.list()][0];
        const hook = [...impl.storage.boundHooks.list()][0];

        await impl.rejectContractOperation("rejected-hook-parent");

        await expect(controller.enabledCount()).resolves.toBe(0);
        expect(impl.storage.boundHooks.get(hook.id)).toBeUndefined();
        expect(impl.storage.actions.get(action.id)).toMatchObject({
          state: "rejected",
          enabled: false,
        });
        expect(impl.storage.actions.get(action.id).hookId).toBeUndefined();
      },
    );
  });

  it("retracts a staged hook and resolves its parent when the Contract is deleted", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-staged-hook-deletion"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        const call = contractCall();
        const controller = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "deleted-staged-hook"}});
        const callback = impl.ctx.exports.HookLifecycleTestTarget({props: {id: "deleted-staged-callback"}});
        impl.storage.contracts.put({
          id: call.contractId,
          artifactHash: call.artifactHash,
          runtimeHarnessVersion: "5",
          sourceGatekeeperId: call.sourceGatekeeperId,
          title: "Contract",
          publicTypes: "export interface ContractBinding {}",
          createdAt: new Date(0),
          approvedBy: "admin",
        });
        impl.storage.contractOperations.put({
          id: "deleted-staged-parent",
          contractId: call.contractId,
          artifactHash: call.artifactHash,
          caller: call.caller,
          title: "Install callback",
          description: "Delete before approval",
          state: "pending",
          childActionIds: [],
          createdAt: new Date(0),
        });
        await impl.bindHook(
          call.sourceGatekeeperId,
          controller,
          callback,
          {title: "Incoming event", description: "Contract callback"},
          call.caller,
          call,
          {type: "manual", operationId: "deleted-staged-parent"},
        );
        const action = [...impl.storage.actions.list()][0];

        await impl.deleteContract(call.contractId);

        await expect(controller.enabledCount()).resolves.toBe(0);
        expect([...impl.storage.boundHooks.list()]).toEqual([]);
        expect(impl.storage.actions.get(action.id)).toMatchObject({
          state: "rejected",
          enabled: false,
        });
        expect(impl.storage.actions.get(action.id).hookId).toBeUndefined();
        expect(impl.storage.contractOperations.get("deleted-staged-parent").state)
          .toBe("rejected");
      },
    );
  });
});
