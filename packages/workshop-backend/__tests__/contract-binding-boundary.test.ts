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
  });
  impl.storage.gadgets.put({
    id: 10,
    title: "Other Consumer",
    created: new Date(0),
    bindingName: "OTHER_CONSUMER",
  });
}

describe("Contract binding boundary", () => {
  it("fails closed when an Agent environment cites a raw Source", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-binding-separated-envs"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        seedWorkpieces(impl);
        impl.makeBindingLoopback = vi.fn((target: object) => ({kind: "binding", target}));
        expect(impl.getEnvForLoader(9, {from: "gadget", gadgetId: 9})).toEqual({
          GADGET: {kind: "binding", target: {type: "gadget", id: 9}},
        });
        expect(() => impl.getEnvForAgent(3, {
          SOURCE: {type: "workpiece", id: 17},
          CONTRACT: {type: "workpiece", id: 70},
        })).toThrow("Raw Source binding SOURCE is unsupported");
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
