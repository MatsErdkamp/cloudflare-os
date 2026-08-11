import {describe, expect, it} from "vitest";
import {env, RpcStub, RpcTarget} from "cloudflare:workers";
import {runInDurableObject} from "cloudflare:test";
import {currentContractArtifact} from "./contract-artifact-fixture";
import {keyString} from "@gadgets/typed-storage";
import {
  buildContractReviewEvidence,
  createReviewBuildManifest,
  type ReviewBuildRunnerFactory,
} from "@gadgets/contract-review-builder";
import {R2ContractArtifactStore} from "../src/contract-artifacts";
import {R2ContractReviewEvidenceStore} from "../src/contract-review-evidence";
import {hashAuthorityCommand, hashAuthorityRequest} from "@gadgets/workshop-shared/authority-api";

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

async function decideArtifact(
  instance: OverseerDurableObject,
  message: any,
  decision: "approved" | "rejected",
): Promise<void> {
  const authority = await instance.openAuthority("user-id", new RpcStub<() => void>(() => {}));
  try {
    const snapshot = await authority.getSessionSnapshot();
    const operation = await authority.beginOperation({
      idempotencyKey: `artifact-decision:${message.requestId}:${decision}`,
      requestDigest: await hashAuthorityRequest({
        type: "artifactProposalDecision",
        requestId: message.requestId,
        proposalId: message.proposalId,
        decision,
      }),
    });
    const payload = {
      type: "decideArtifactProposal" as const,
      operationId: operation.id,
      stepKey: "artifact-decision",
      expectedAuthorityEpoch: snapshot.authorityEpoch,
      expectedPermissionGeneration: snapshot.permissionGeneration,
      requestId: message.requestId,
      expectedProposalRevision: message.proposalRevision,
      evidence: {
        artifactHash: message.artifactHash,
        proposalId: message.proposalId,
        reviewBundleHash: message.reviewBundleHash,
        reviewComparisonHash: message.reviewComparisonHash,
        policyHash: message.policyHash,
        generatorIdentityHash: message.generatorIdentityHash,
        baseline: message.baseline,
      },
      decision,
    };
    await authority.execute({...payload, requestDigest: await hashAuthorityCommand(payload)});
    await expect(authority.getOperation(operation.id)).resolves.toMatchObject({
      state: "completed",
      lastCompletedStep: "artifact-decision",
      result: {type: "artifactProposalDecided", decision},
    });
  } finally {
    authority[Symbol.dispose]?.();
  }
}

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
  const inputs = {
    modules: {"contract.ts": "export const originalSource = true;"},
    mainModule: "contract.ts",
    sourceTypes: SOURCE_TYPES,
    sourceRootType: "Source",
    dependencies: {},
    compatibilityDate: "2026-02-02",
    compatibilityFlags: ["allow_irrevocable_stub_storage"],
  };
  const candidate = {
    artifact,
    inputs,
    trace: {entries: [], artifactHash: artifact.hash},
    creation: {createdAt: "2026-02-02T00:00:00.000Z"},
  };
  const identity = (digit: string) => `sha256:${digit.repeat(64)}`;
  const runnerFactory: ReviewBuildRunnerFactory = {
    create({role}) {
      return {
        async build() {
          return {
            candidate,
            isolation: {
              role,
              producerIdentity: `test-${role}`,
              environmentIdentity: `fresh-${role}`,
              network: "disabled" as const,
              mutableState: "fresh" as const,
              networkAttempts: 0,
            },
            dependencyLock: {entries: []},
            directDependencyRequests: [],
            publicExportedSurface: ["export interface ContractBinding extends RpcTarget {\n    read(id: string): Promise<string>;\n}"],
            sourceExportedSurface: ["interface SourceRoot {\n    read(id: string): Promise<string>;\n}"],
            toolchain: {components: [
              {name: "@gadgets/contractors", identity: identity("1")},
              {name: "esbuild", identity: identity("2")},
              {name: "typescript", identity: identity("3")},
            ]},
            recipe: {
              name: "contract-current",
              compatibilityDate: artifact.runtimeProfile.compatibilityDate,
              compatibilityFlags: artifact.runtimeProfile.compatibilityFlags,
              target: "es2022",
              platform: "neutral",
              moduleFormat: "esm",
              externals: ["cloudflare:workers"],
              publicRoot: "ContractBinding",
              authoringAbiHash: artifact.runtimeProfile.authoringAbi.declarationHash,
              runtimeHarnessHash: artifact.runtimeProfile.runtimeHarnessHash,
              runtimeModuleSetHash: artifact.runtimeProfile.runtimeModuleSetHash,
              runtimeProfileHash: artifact.runtimeProfileHash,
            },
          };
        },
        [Symbol.dispose]() {},
      };
    },
  };
  const evidence = await buildContractReviewEvidence({
    buildManifest: await createReviewBuildManifest(inputs, [], {components: [
      {name: "@gadgets/contractors", identity: identity("1")},
      {name: "esbuild", identity: identity("2")},
      {name: "typescript", identity: identity("3")},
    ]}),
    submittedProvenance: {
      submittedBy: {identity: "test-builder", generation: 1},
      authorship: "test fixture",
      origin: {kind: "workspaceChat", reference: "chat:3"},
    },
    policySnapshot: {},
    baseline: {kind: "none"},
  }, runnerFactory);
  await Promise.all([
    new R2ContractArtifactStore(env.BLUEPRINT_CONTENT).put(artifact),
    new R2ContractReviewEvidenceStore(env.BLUEPRINT_CONTENT).put(evidence),
  ]);
  return {
    sourceGatekeeperId: 17,
    targetGadgetId: 9,
    title: "Reviewed Contract",
    bindingName: "REVIEWED",
    artifactHash: artifact.hash,
    reviewBundleHash: evidence.bundleHash,
    reviewComparisonHash: evidence.comparisonHash,
    policyHash: evidence.bundle.build.policySnapshot.hash,
    generatorIdentityHash: evidence.comparison.generator.identity,
    baseline: {type: "none" as const},
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
        )).resolves.not.toBeNull();
        expect(impl.consumeCapturedConnectionRequests(3)).toEqual([
          expect.objectContaining({
            type: "contractRequest",
            requestId: proposal.requestId,
            proposalId: proposal.proposalId,
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
        })).rejects.toThrow("Artifact is unavailable");
        await expect(impl.proposeContract(3, {
          ...input,
          policyHash: `sha256:${"0".repeat(64)}`,
        })).rejects.toThrow("references do not match");
        expect(impl.consumeCapturedConnectionRequests(3)).toEqual([]);
      },
    );
  });

  it("re-approves one reproduced R2 Artifact at a new epoch without trusting chat snapshots", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-proposal-r2-reapproval"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);
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
        const input = await proposalInput(COMPILER_STYLE_MODULE);

        const acceptProposal = async (bindingName: string) => {
          const proposal = await impl.proposeContract(3, {...input, bindingName});
          const [body] = impl.consumeCapturedConnectionRequests(3);
          const message = {
            chatId: 3,
            sequence: impl.nextChatSequence(3),
            timestamp: impl.getChatTimestamp(),
            author: {type: "agent", id: "model", name: "Agent"},
            ...body,
          };
          message.sourceCode = "throw new Error('display snapshot must not execute')";
          message.publicTypes = "export interface ContractBinding { displayOnly: never }";
          impl.storage.chats.put(message);
          if (bindingName === "REVIEWED") {
            const reviewAuthority = await instance.openAuthority(
              "user-id",
              new RpcStub<() => void>(() => {}),
            );
            const reader = await reviewAuthority.openReviewEvidence({
              bundleHash: message.reviewBundleHash,
              comparisonHash: message.reviewComparisonHash,
            });
            await expect(reader.getComparisonJson()).resolves.toContain(message.reviewBundleHash);
            reviewAuthority[Symbol.dispose]?.();
            await expect(reader.getComparisonJson()).rejects.toThrow("Authority unavailable");
            reader[Symbol.dispose]?.();
          }
          await decideArtifact(instance, message, "approved");
          const approval = impl.workspaceAuthority.query({
            type: "artifactApprovalByProposal",
            proposalId: proposal.proposalId,
          });
          expect(approval).toMatchObject({
            type: "artifactApprovalByProposal",
            value: {artifactHash: proposal.artifactHash, decision: "approved"},
          });
          return approval.value.approvalEpoch;
        };

        await expect(acceptProposal("REVIEWED")).resolves.toBe(1);
        await expect(acceptProposal("REVIEWED_AGAIN")).resolves.toBe(2);
        expect([...impl.storage.contracts.list()]).toHaveLength(0);
        const decisions = [...impl.storage.chats.list()].filter(
          (message: any) => message.type === "contractRequest",
        );
        expect(decisions).toEqual([
          expect.objectContaining({state: "approved", sourceCode: expect.stringContaining("display snapshot")}),
          expect.objectContaining({state: "approved", sourceCode: expect.stringContaining("display snapshot")}),
        ]);

        const builderProposal = await impl.proposeContract(3, {
          ...input,
          bindingName: "BUILDER_CANNOT_APPROVE",
        });
        const [builderBody] = impl.consumeCapturedConnectionRequests(3);
        impl.storage.chats.put({
          chatId: 3,
          sequence: impl.nextChatSequence(3),
          timestamp: impl.getChatTimestamp(),
          author: {type: "agent", id: "model", name: "Agent"},
          ...builderBody,
        });
        await expect(instance.openAuthority(
          "builder-id",
          new RpcStub<() => void>(() => {}),
        )).rejects.toThrow("Authority unavailable");
        const ownerAuthority = await instance.openAuthority(
          "user-id",
          new RpcStub<() => void>(() => {}),
        );
        const ownerControl = await ownerAuthority.openOwnerControl();
        expect(ownerControl).not.toBeNull();
        const grantSnapshot = await ownerAuthority.getSessionSnapshot();
        const grantOperation = await ownerAuthority.beginOperation({
          idempotencyKey: "grant-builder",
          requestDigest: await hashAuthorityRequest({principalId: "builder-id", enabled: true}),
        });
        const grantPayload = {
          type: "setManagerGrant" as const,
          operationId: grantOperation.id,
          stepKey: "set-manager-grant",
          expectedAuthorityEpoch: grantSnapshot.authorityEpoch,
          expectedPermissionGeneration: grantSnapshot.permissionGeneration,
          principalId: "builder-id",
          enabled: true,
        };
        await ownerControl!.execute({
          ...grantPayload,
          requestDigest: await hashAuthorityRequest(grantPayload),
        });
        const managerAuthority = await instance.openAuthority(
          "builder-id",
          new RpcStub<() => void>(() => {}),
        );
        await expect(managerAuthority.getSessionSnapshot()).resolves.toMatchObject({
          permissionGeneration: 1,
        });
        const revokeOperation = await ownerAuthority.beginOperation({
          idempotencyKey: "revoke-builder",
          requestDigest: await hashAuthorityRequest({principalId: "builder-id", enabled: false}),
        });
        const revokePayload = {
          ...grantPayload,
          operationId: revokeOperation.id,
          principalId: "builder-id",
          enabled: false,
        };
        await ownerControl!.execute({
          ...revokePayload,
          requestDigest: await hashAuthorityRequest(revokePayload),
        });
        await expect(managerAuthority.getSessionSnapshot()).rejects.toThrow("Authority unavailable");
        ownerAuthority[Symbol.dispose]?.();
        await expect(ownerControl!.execute({
          ...revokePayload,
          requestDigest: await hashAuthorityRequest(revokePayload),
        })).rejects.toThrow("Authority unavailable");
        managerAuthority[Symbol.dispose]?.();
        ownerControl![Symbol.dispose]?.();
        expect(impl.workspaceAuthority.query({
          type: "artifactApprovalByProposal",
          proposalId: builderProposal.proposalId,
        })).toEqual({type: "artifactApprovalByProposal", value: undefined});
        client[Symbol.dispose]?.();
      },
    );
  });

  it("fails closed on corrupt immutable Artifact evidence without blocking rejection", async () => {
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
        impl.storage.chats.put(message);
        await env.BLUEPRINT_CONTENT.put(
          `contracts/artifacts/${proposal.artifactHash}.json`,
          "{",
        );

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

        await expect(decideArtifact(instance, message, "approved")).rejects.toThrow();
        const stored = impl.storage.chats.get(
          `${keyString(message.chatId)}.${keyString(message.sequence)}`,
        );
        expect(stored.accepting).toBeUndefined();
        await expect(decideArtifact(instance, message, "rejected")).resolves.toBeUndefined();
        client[Symbol.dispose]?.();
      },
    );
  });
});
