import {describe, expect, it} from "vitest";
import {env, RpcStub, RpcTarget} from "cloudflare:workers";
import {runInDurableObject} from "cloudflare:test";
import {currentContractArtifact} from "./contract-artifact-fixture";
import {hashArtifact, type ContractArtifact} from "@gadgets/contractors/artifact";
import {keyString} from "@gadgets/typed-storage";

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
    startSession: async () => new RpcStub(new class extends RpcTarget {
      read(): string { return "private-source"; }
    }()),
  });
}

async function proposalInput(sourceCode: string, publicTypes = `
  import {RpcTarget} from "cloudflare:workers";
  export interface ContractBinding extends RpcTarget { ping(): string; }
`) {
  const artifact = await currentContractArtifact({
    sourceCode,
    publicTypes,
    sourceTypes: SOURCE_TYPES,
    compatibilityDate: "2026-02-02",
  });
  return {
    sourceGatekeeperId: 17,
    targetGadgetId: 9,
    title: "Reviewed Contract",
    bindingName: "REVIEWED",
    artifactJson: JSON.stringify(artifact),
  };
}

describe("Contract proposal compilation boundary", () => {
  it("runs and retracts the current Artifact through the production Workshop lifecycle adapter", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-current-production-adapter"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);
        const artifact = await currentContractArtifact({
          sourceCode: COMPILER_STYLE_MODULE,
          publicTypes: `
            import {RpcTarget} from "cloudflare:workers";
            export interface ContractBinding extends RpcTarget { ping(): string; }
          `,
          sourceTypes: SOURCE_TYPES,
          compatibilityDate: "2026-02-02",
        });
        const contract = await impl.createContract(
          artifact, 17, "Current Contract", "admin", 9, "CURRENT",
        );
        const root = await impl.startContractSession(
          contract.id, {from: "gadget", gadgetId: 9}, "ping",
        );
        try {
          await expect(root.ping()).resolves.toBe("pong");
          await impl.deleteContract(contract.id);
          await expect(Promise.resolve().then(() => root.ping())).rejects.toThrow();
          expect(impl.storage.contracts.get(contract.id)).toBeUndefined();
          expect(impl.storage.contractTombstones.get(contract.id)).toBeDefined();
        } finally {
          root[Symbol.dispose]?.();
        }
      },
    );
  }, 15_000);

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

        const artifact = JSON.parse(input.artifactJson) as ContractArtifact;
        await expect(impl.proposeContract(3, {
          ...input,
          artifactJson: JSON.stringify({...artifact, hash: `sha256:${"0".repeat(64)}`}),
        })).rejects.toThrow("content does not match");
        const {hash: _hash, ...authority} = artifact;
        const staleAuthority = {...authority, sourceTypeHash: "0".repeat(64)};
        await expect(impl.proposeContract(3, {
          ...input,
          artifactJson: JSON.stringify({
            hash: await hashArtifact(staleAuthority),
            ...staleAuthority,
          }),
        })).rejects.toThrow("Source types");
        expect(impl.consumeCapturedConnectionRequests(3)).toEqual([]);
      },
    );
  });

  it("leaves a corrupt retained Artifact proposal denyable", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-proposal-corrupt-retained-artifact"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);
        const proposal = await impl.proposeContract(3, await proposalInput(COMPILER_STYLE_MODULE));
        const [body] = impl.consumeCapturedConnectionRequests(3);
        const message = {
          chatId: 3,
          sequence: impl.nextChatSequence(3),
          timestamp: impl.getChatTimestamp(),
          author: {type: "agent", id: "model", name: "Agent"},
          ...body,
        };
        message.artifactJson = "{";
        impl.storage.chats.put(message);

        impl.ownerId = "user-id";
        impl.ensureAmbientCapsules = async () => {};
        impl.markOutputsDirty = () => {};
        impl.joinPresence = () => () => {};
        impl.joinOutputsFanout = () => () => {};
        impl.users = {
          idFromString: (id: string) => id,
          get: () => ({whoami: async () => ({type: "user", id: "profile-id", name: "User"})}),
        };
        const notifyClosed = new RpcStub<() => void>(() => {});
        const client = await instance.open("user-id", "profile-id", notifyClosed);

        await expect(client.acceptContractRequest(proposal.requestId)).rejects.toThrow();
        const stored = impl.storage.chats.get(
          `${keyString(message.chatId)}.${keyString(message.sequence)}`,
        );
        expect(stored.accepting).toBeUndefined();
        await expect(client.denyContractRequest(proposal.requestId)).resolves.toBeUndefined();
        client[Symbol.dispose]?.();
      },
    );
  });
});
