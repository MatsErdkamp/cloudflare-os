import {describe, expect, it} from "vitest";
import {env} from "cloudflare:workers";
import {runInDurableObject} from "cloudflare:test";
import {
  CONTRACT_RUNTIME_HARNESS_VERSION,
  hashArtifact,
  hashSourceTypes,
} from "@gadgets/contractors/runtime";

import type {OverseerDurableObject} from "../src/overseer.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>;
  }
}

const COMPILER_STYLE_MODULE = `
  import {RpcTarget} from "cloudflare:workers";
  class Binding extends RpcTarget { ping() { return "pong"; } }
  function createContract() { return new Binding(); }
  export {createContract as default};
`;
const SOURCE_TYPES = "interface Source { read(): Promise<string>; }";

function prepareProposalFixture(impl: any): void {
  impl.storage.gatekeepers.put({
    id: 17,
    class: null,
    resourceTitle: "Private Source",
    resourceUrl: "https://source.example/17",
  });
  impl.storage.gadgets.put({
    id: 9,
    title: "Target Gadget",
    created: new Date(0),
    bindingName: "TARGET",
    bindings: {},
  });
  impl.getGatekeeperFacet = () => ({
    describe: async () => ({title: "Private Source", url: "https://source.example/17", tsType: "Source"}),
    getTypeScriptTypes: async () => SOURCE_TYPES,
  });
}

async function proposalInput(sourceCode: string, publicTypes = `
  import {RpcTarget} from "cloudflare:workers";
  export interface ContractBinding extends RpcTarget { ping(): string; }
`) {
  const authority = {
    mainModule: "contract.js",
    modules: {"contract.js": sourceCode},
    publicTypes,
    publicRootType: "ContractBinding" as const,
    sourceTypeHash: await hashSourceTypes(SOURCE_TYPES),
    sourceRootType: "Source",
    dependencies: [],
    compatibilityDate: "2026-02-02",
    runtimeHarnessVersion: CONTRACT_RUNTIME_HARNESS_VERSION,
  };
  return {
    sourceGatekeeperId: 17,
    targetGadgetId: 9,
    title: "Reviewed Contract",
    bindingName: "REVIEWED",
    sourceCode,
    publicTypes,
    dependencies: [],
    artifactHash: await hashArtifact(authority),
    sourceTypeHash: authority.sourceTypeHash,
    sourceRootType: authority.sourceRootType,
    compatibilityDate: authority.compatibilityDate,
    runtimeHarnessVersion: authority.runtimeHarnessVersion,
  };
}

describe("Contract proposal compilation boundary", () => {
  it("accepts the compiler's named default-export ESM form for human review", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-proposal-compiled-esm"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);

        const proposal = await impl.proposeContract(3, await proposalInput(COMPILER_STYLE_MODULE));

        expect(proposal.artifactHash).toMatch(/^sha256:[0-9a-f]{64}$/);
        await expect(env.BLUEPRINT_CONTENT.get(
          `contracts/artifacts/${proposal.artifactHash}.json`,
        )).resolves.toBeNull();
        expect(impl.consumeCapturedConnectionRequests(3)).toEqual([
          expect.objectContaining({
            type: "contractRequest",
            requestId: proposal.requestId,
            sourceCode: COMPILER_STYLE_MODULE,
            sourceRootType: "Source",
            compatibilityDate: "2026-02-02",
            state: "pending",
          }),
        ]);
      },
    );
  });

  it("rejects an executable module that does not actually export a default factory", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-proposal-missing-default"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);

        await expect(impl.proposeContract(3, await proposalInput(
          COMPILER_STYLE_MODULE.replace("export {createContract as default};", "export {createContract};"),
        ))).rejects.toThrow();
        expect(impl.consumeCapturedConnectionRequests(3)).toEqual([]);
      },
    );
  });

  it("accepts the compiler's exported ContractBinding alias declaration", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-proposal-binding-alias"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);

        await expect(impl.proposeContract(3, await proposalInput(COMPILER_STYLE_MODULE, `
          import {RpcTarget} from "cloudflare:workers";
          interface CustomerEmail extends RpcTarget { ping(): string; }
          export type {CustomerEmail as ContractBinding};
        `))).resolves.toMatchObject({artifactHash: expect.stringMatching(/^sha256:/)});
      },
    );
  });

  it("rejects a compiler claim that does not match the submitted artifact or current Source", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-proposal-integrity"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);
        const input = await proposalInput(COMPILER_STYLE_MODULE);

        await expect(impl.proposeContract(3, {
          ...input,
          artifactHash: `sha256:${"0".repeat(64)}`,
        })).rejects.toThrow("artifact hash");
        await expect(impl.proposeContract(3, {
          ...input,
          sourceTypeHash: "stale-source-types",
        })).rejects.toThrow("Source types");
        expect(impl.consumeCapturedConnectionRequests(3)).toEqual([]);
      },
    );
  });
});
