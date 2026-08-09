import {describe, expect, it} from "vitest";

import {
  createWorkspaceAuthorityModule,
  type LegacyGadgetAuthorityRecord,
} from "../src/authority/workspace-authority.js";
import {makeMockStorage} from "./mock-storage.js";

type TestGadget = LegacyGadgetAuthorityRecord & {title: string};

function makeModule() {
  const gadgets = new Map<number, TestGadget>([
    [1, {id: 1, title: "Consumer", bindings: {}}],
    [2, {id: 2, title: "Other", bindings: {}}],
  ]);
  const contracts = new Set([10]);
  const gatekeepers = new Set([20]);
  const bumped: number[][] = [];
  const module = createWorkspaceAuthorityModule(makeMockStorage(), {
    getGadget(id) {
      return gadgets.get(id);
    },
    listGadgets() {
      return gadgets.values();
    },
    putGadget(gadget) {
      gadgets.set(gadget.id, structuredClone(gadget));
    },
    hasContract(id) {
      return contracts.has(id);
    },
    hasGatekeeper(id) {
      return gatekeepers.has(id);
    },
    bumpConsumers(ids) {
      bumped.push([...ids]);
    },
  });
  return {module, gadgets, bumped};
}

describe("Workspace Authority module", () => {
  it("initializes and reports authority state through its production command/query interface", () => {
    const {module} = makeModule();

    expect(module.authority.query({type: "status"})).toEqual({
      state: "uninitialized",
      revision: 0,
      eventHighWatermark: 0,
      pendingEffects: 0,
    });

    expect(module.authority.execute({type: "initialize"})).toEqual({
      type: "initialized",
      changed: true,
      revision: 1,
    });
    expect(module.authority.execute({type: "initialize"})).toEqual({
      type: "initialized",
      changed: false,
      revision: 1,
    });
    expect(module.authority.query({type: "status"})).toEqual({
      state: "legacy",
      revision: 1,
      eventHighWatermark: 1,
      pendingEffects: 0,
    });
    expect(module.authority.reconcile()).toEqual({attemptedEffects: 0});
  });

  it("keeps existing binding behavior behind the explicit compatibility interface", () => {
    const {module, gadgets, bumped} = makeModule();

    expect(() => module.compatibility.bindContract({
      consumerId: 1,
      name: "RAW_SOURCE",
      contractId: 20,
    })).toThrow("not raw Sources");

    module.compatibility.bindContract({consumerId: 1, name: "REVIEWED", contractId: 10});
    expect(module.compatibility.queryVisibleBindings({consumerId: 1})).toEqual([
      ["REVIEWED", {target: 10}],
    ]);
    expect(() => module.compatibility.bindContract({
      consumerId: 2,
      name: "REUSED",
      contractId: 10,
    })).toThrow("separate Contract instance");

    module.compatibility.renameBinding({consumerId: 1, oldName: "REVIEWED", newName: "FILES"});
    module.compatibility.unbind({consumerId: 1, name: "FILES"});
    expect(gadgets.get(1)?.bindings).toEqual({});
    expect(bumped).toEqual([[1], [1], [1]]);
  });

  it("guards and durably bounds legacy Manager Source telemetry", () => {
    const {module} = makeModule();

    for (let chatId = 1; chatId <= 20; chatId++) {
      const access = module.compatibility.authorizeLegacyManagerSource({
        surface: "managerAgentAuthoring",
        chatId,
        gatekeeperId: 20,
      });
      expect(access.gatekeeperId).toBe(20);
      expect(module.compatibility.consumeLegacyManagerSourceAccess(access)).toEqual({
        chatId,
        gatekeeperId: 20,
      });
      expect(() => module.compatibility.consumeLegacyManagerSourceAccess(access))
        .toThrow("forged, reused, or issued before restart");
    }

    const telemetry = module.compatibility.queryLegacyManagerSourceTelemetry();
    expect(telemetry.totalUses).toBe(20);
    expect(telemetry.recentUses).toHaveLength(16);
    expect(telemetry.recentUses[0]).toMatchObject({chatId: 5, gatekeeperId: 20});
    expect(telemetry.recentUses[15]).toMatchObject({chatId: 20, gatekeeperId: 20});
  });
});
