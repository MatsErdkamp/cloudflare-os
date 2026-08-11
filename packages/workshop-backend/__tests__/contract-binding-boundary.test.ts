import {describe, expect, it, vi} from "vitest";
import {env} from "cloudflare:workers";
import {runInDurableObject} from "cloudflare:test";

import type {OverseerDurableObject} from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

function seedWorkpieces(impl: any): void {
  impl.storage.gatekeepers.put({
    id: 17,
    class: null,
    resourceTitle: "Private Source",
  });
  impl.storage.contracts.put({
    id: 70,
    artifactHash: "sha256:artifact",
    runtimeProfileHash: `sha256:${"1".repeat(64)}`,
    sourceGatekeeperId: 17,
    title: "Reviewed Contract",
    publicTypes: "export interface ContractBinding {}",
    createdAt: new Date(0),
    approvedBy: "admin",
  });
  impl.storage.gadgets.put({
    id: 9,
    title: "Consumer",
    created: new Date(0),
    bindingName: "CONSUMER",
    bindings: {},
  });
  impl.storage.gadgets.put({
    id: 10,
    title: "Other Consumer",
    created: new Date(0),
    bindingName: "OTHER_CONSUMER",
    bindings: {},
  });
}

describe("Contract binding boundary", () => {
  it("rejects raw Sources at the binding mutation chokepoint", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-binding-rejects-source"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        seedWorkpieces(impl);

        expect(() => impl.bindWorkpiece(9, "PRIVATE_SOURCE", 17))
          .toThrow("not raw Sources");
        expect(impl.storage.gadgets.get(9).bindings).toEqual({});

        expect(() => impl.bindWorkpiece(9, "REVIEWED", 70)).not.toThrow();
        expect(impl.storage.gadgets.get(9).bindings.REVIEWED).toEqual({target: 70});
        expect(() => impl.bindWorkpiece(10, "REUSED", 70))
          .toThrow("separate Contract instance");
        expect(impl.storage.gadgets.get(10).bindings).toEqual({});
      },
    );
  });

  it("retracts dependent Contract instances when their private Source is removed", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-binding-source-removal"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        seedWorkpieces(impl);
        impl.bindWorkpiece(9, "REVIEWED", 70);
        const invalidated: number[] = [];
        impl.invalidateContractEndpoint = async (contract: {id: number}) => {
          expect(impl.storage.gatekeepers.get(17)).toBeDefined();
          invalidated.push(contract.id);
        };

        await impl.removeGatekeeper(17);

        expect(invalidated).toEqual([70]);
        expect(impl.storage.gatekeepers.get(17)).toBeUndefined();
        expect(impl.storage.contracts.get(70)).toBeUndefined();
        expect(impl.storage.contractTombstones.get(70)).toBeDefined();
        expect(impl.storage.gadgets.get(9).bindings).toEqual({});
      },
    );
  });

  it("builds Consumer and Manager environments through distinct loopbacks", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-binding-separated-envs"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        seedWorkpieces(impl);
        const gadget = impl.storage.gadgets.get(9);
        gadget.bindings.REVIEWED = {target: 70};
        impl.storage.gadgets.put(gadget);

        impl.makeBindingLoopback = vi.fn((target: object) => ({kind: "binding", target}));
        impl.makeManagerSourceLoopback = vi.fn((access: {gatekeeperId: number}) => {
          const consumed = impl.legacyWorkspaceAuthority.consumeLegacyManagerSourceAccess(access);
          return {kind: "manager-source", id: consumed.gatekeeperId};
        });

        expect(impl.getEnvForLoader(9, {from: "gadget", gadgetId: 9})).toEqual({
          GADGET: {kind: "binding", target: {type: "gadget", id: 9}},
          REVIEWED: {kind: "binding", target: {type: "contract", id: 70}},
        });
        expect(impl.getEnvForAgent(3, {
          SOURCE: {type: "workpiece", id: 17},
          CONTRACT: {type: "workpiece", id: 70},
        })).toEqual({
          SOURCE: {kind: "manager-source", id: 17},
          CONTRACT: {kind: "binding", target: {type: "contract", id: 70}},
        });
        expect(impl.legacyWorkspaceAuthority.queryLegacyManagerSourceTelemetry())
          .toMatchObject({totalUses: 1, recentUses: [{chatId: 3, gatekeeperId: 17}]});
      },
    );
  });

  it("refuses to load a legacy raw-Source edge into a Consumer environment", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-binding-rejects-legacy-edge"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        seedWorkpieces(impl);
        const gadget = impl.storage.gadgets.get(9);
        gadget.bindings.LEGACY_SOURCE = {target: 17};
        impl.storage.gadgets.put(gadget);
        impl.makeBindingLoopback = vi.fn((target: object) => ({target}));

        expect(() => impl.getEnvForLoader(9, {from: "gadget", gadgetId: 9}))
          .toThrow("No such Contract");
      },
    );
  });

  it("never falls back to legacy Contract dispatch after canonical cutover", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-binding-no-post-cutover-legacy-dispatch"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        seedWorkpieces(impl);
        impl.ensureCanonicalAuthorityActive();
        impl.openContractSourceSession = vi.fn();

        await expect(impl.startContractSession(70, {from: "user"}))
          .rejects.toThrow("Canonical Contract Binding is stale");
        expect(impl.openContractSourceSession).not.toHaveBeenCalled();
      },
    );
  });
});
