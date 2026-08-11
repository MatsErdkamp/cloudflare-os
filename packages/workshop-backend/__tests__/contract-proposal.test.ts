import {describe, expect, it, vi} from "vitest";
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
`, baseline?: Readonly<{evidence: any; artifactApprovalId: string}>) {
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
    baseline: baseline
      ? {
          kind: "bundle",
          bundleHash: baseline.evidence.bundleHash,
          artifactApprovalReference: baseline.artifactApprovalId,
        }
      : {kind: "none"},
    ...(baseline ? {
      baselineBundle: baseline.evidence.bundle,
      baselineBlobs: baseline.evidence.blobs,
    } : {}),
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
    baseline: baseline
      ? {
          type: "bundle" as const,
          bundleHash: baseline.evidence.bundleHash,
          artifactApprovalId: baseline.artifactApprovalId,
        }
      : {type: "none" as const},
    testEvidence: evidence,
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

  it("publishes a separately decided standing Binding only after provider and endpoint acknowledgement", async () => {
    await runInDurableObject(
      env.TEST_OVERSEER.getByName("contract-standing-installation"),
      async (instance: OverseerDurableObject) => {
        const impl = (instance as any).impl;
        prepareProposalFixture(impl);
        const input = await proposalInput(COMPILER_STYLE_MODULE);
        const proposal = await impl.proposeContract(3, {...input, bindingName: "R2_STORAGE"});
        const [body] = impl.consumeCapturedConnectionRequests(3);
        const message: any = {
          chatId: 3,
          sequence: impl.nextChatSequence(3),
          timestamp: impl.getChatTimestamp(),
          author: {type: "agent", id: "model", name: "Agent"},
          ...body,
        };
        impl.storage.chats.put(message);
        impl.ownerId = "user-id";
        await decideArtifact(instance, message, "approved");
        const approval = impl.workspaceAuthority.query({
          type: "artifactApprovalByProposal",
          proposalId: proposal.proposalId,
        }).value;
        const providerIdentity = {
          providerId: "cloudflare-r2",
          accountId: "account-1",
          sourceId: "private-root",
          sourceGeneration: 1,
        };
        let prepareCalls = 0;
        let activateFailuresRemaining = 1;
        const provider: any = {
          prepareProviderAuthority: async (request: any) => {
            prepareCalls++;
            return {
              provider: providerIdentity,
              contractInstance: request.contractInstance,
              backingReference: "opaque-backing",
              capabilityGeneration: 1,
              state: "prepared",
              cleanup: "not-required",
            };
          },
          activateProviderAuthority: async (request: any) => {
            if (activateFailuresRemaining-- > 0) throw new Error("provider temporarily unavailable");
            return {
              provider: providerIdentity,
              contractInstance: request.contractInstance,
              backingReference: "opaque-backing",
              capabilityGeneration: 1,
              state: "active",
              cleanup: "not-required",
            };
          },
          deactivateProviderAuthority: async (request: any) => ({
            provider: providerIdentity,
            contractInstance: request.contractInstance,
            backingReference: "opaque-backing",
            capabilityGeneration: 2,
            state: "inactive",
            cleanup: "not-required",
          }),
          destroyProviderAuthority: async (request: any) => ({
            provider: providerIdentity,
            contractInstance: request.contractInstance,
            backingReference: "opaque-backing",
            capabilityGeneration: 3,
            state: "destroyed",
            cleanup: "complete",
          }),
          startProviderAuthoritySession: async () => new RpcStub(new class extends RpcTarget {}()),
        };
        impl.describeCanonicalProviderSource = async () => ({
          identity: providerIdentity,
          health: "healthy",
          providerNativeScope: {
            resources: ["deployment-r2-bucket"],
            operations: ["head", "get", "list", "put", "delete"],
            recipients: [],
            egress: [],
          },
          providerNativeRevocationGranularity: "deployment-resource",
          localEnforcementRevocationGranularity: "contract-instance-backing",
        });
        impl.getCanonicalProviderFacet = () => provider;
        const endpoints = new Map<number, {snapshot: any; cancellation: any}>();
        impl.getContractFacet = (contract: any) => ({
          install: async (snapshot: any, _observer: any, cancellation: any) => {
            endpoints.set(contract.id, {snapshot, cancellation: cancellation?.dup?.() ?? cancellation});
            return {
              endpointId: snapshot.endpointId,
              reachabilityGeneration: snapshot.reachabilityGeneration,
            };
          },
          invalidate: async (generation: number) => {
            const endpoint = endpoints.get(contract.id)!;
            expect(generation).toBe(endpoint.snapshot.reachabilityGeneration);
            await endpoint.cancellation?.cancel(endpoint.snapshot);
            return {
              endpointId: endpoint.snapshot.endpointId,
              reachabilityGeneration: endpoint.snapshot.reachabilityGeneration,
              invalidated: true,
              cancelledInvocations: 0,
              cleanupFailures: 0,
            };
          },
          startSession: async () => new RpcStub(new class extends RpcTarget {
            ping(): string { return "pong"; }
          }()),
        });
        let authority = await instance.openAuthority(
          "user-id",
          new RpcStub<() => void>(() => {}),
        );
        const snapshot = await authority.getSessionSnapshot();
        const operation = await authority.beginOperation({
          idempotencyKey: "install-standing-r2",
          requestDigest: await hashAuthorityRequest({proposalId: proposal.proposalId}),
        });
        const payload = {
          type: "installStandingBinding" as const,
          operationId: operation.id,
          stepKey: "install-standing-binding",
          expectedAuthorityEpoch: snapshot.authorityEpoch,
          expectedPermissionGeneration: snapshot.permissionGeneration,
          requestId: message.requestId,
          proposalId: proposal.proposalId,
          artifactApprovalId: approval.id,
          artifactApprovalEpoch: approval.approvalEpoch,
          targetGadgetId: 9,
          sourceGatekeeperId: 17,
          bindingName: "R2_STORAGE",
          expectedBindingGeneration: 0,
          title: "Reviewed R2 Contract",
          evaluatorPolicyHash: message.policyHash,
        };
        const clock = Date.now();
        const now = vi.spyOn(Date, "now").mockReturnValue(clock);
        await expect(authority.execute({
          ...payload,
          requestDigest: await hashAuthorityCommand(payload),
        })).rejects.toThrow("pending reconciliation");
        authority[Symbol.dispose]?.();
        now.mockReturnValue(clock + 60_000);
        await impl.reconcileWorkspaceAuthorityEffects();
        now.mockRestore();
        authority = await instance.openAuthority("user-id", new RpcStub<() => void>(() => {}));
        const recovered = await authority.getOperation(operation.id);
        if (recovered.result?.type !== "standingBindingInstalled") {
          throw new Error("standing installation did not recover");
        }
        const result = recovered.result;
        expect(result).toMatchObject({
          type: "standingBindingInstalled",
          bindingGeneration: 1,
        });
        if (result.type !== "standingBindingInstalled") throw new Error("installation failed");
        expect(impl.workspaceAuthority.query({
          type: "authorityDebtByBinding",
          bindingId: result.bindingId,
        })).toMatchObject({
          type: "authorityDebtByBinding",
          value: {
            providerNativeScope: {resources: ["deployment-r2-bucket"]},
            effectiveScope: {resources: [`contract-instance:${result.contractInstanceId}`]},
            enforcementLayer: "gatekeeper",
            risk: "medium",
            productionEligibility: "eligible",
          },
        });
        await expect(authority.execute({
          ...payload,
          requestDigest: await hashAuthorityCommand(payload),
        })).resolves.toEqual(result);
        expect(prepareCalls).toBe(1);
        expect(impl.visibleBindings(impl.storage.gadgets.get(9))).toEqual([
          ["R2_STORAGE", expect.objectContaining({target: expect.any(Number)})],
        ]);
        expect(impl.storage.gadgets.get(9).bindings).toEqual({});
        await expect(authority.getOperation(operation.id)).resolves.toMatchObject({
          state: "completed",
          result: {type: "standingBindingInstalled", bindingGeneration: 1},
        });

        const originalInstance = impl.workspaceAuthority.query({
          type: "contractInstance",
          id: result.contractInstanceId,
        }).value;
        const originalRuntimeContract = impl.storage.contracts.get(
          originalInstance.runtimeWorkpieceId,
        );
        const materializeConsumer = (
          hostId: string,
          bindingSetId: string,
          operationPrefix: string,
        ) => {
          const consumerId = impl.workspaceAuthority.ensureHostIdentity("consumer", hostId);
          const consumer = {type: "standing", consumerId, generation: 1};
          const requirementId = impl.workspaceAuthority.ensureHostIdentity(
            "requirement",
            `${hostId}:R2_STORAGE`,
          );
          const requirement = {
            type: "environment",
            bindingSetId,
            bindingSetVersion: 1,
            requirementId,
            requirementVersion: 1,
          };
          const decision = impl.workspaceAuthority.execute({
            type: "recordInstallationDecision",
            operationId: `${operationPrefix}:decision`,
            record: {
              proposalDigest: `sha256:${"d".repeat(64)}`,
              decision: "approved",
              decidedBy: "user-id",
              consumer,
              requirement,
              intendedBindingName: "R2_STORAGE",
              expectedBindingGeneration: 0,
              artifactApprovalId: approval.id,
              upstreamAuthority: originalInstance.upstreamAuthority,
              authorityMode: "shared",
              sharedState: {type: "isolated"},
              evaluatorPolicyHash: message.policyHash,
            },
          });
          const runtimeWorkpieceId = impl.allocateWorkpieceId();
          const prepared = impl.workspaceAuthority.execute({
            type: "prepareContractInstance",
            operationId: `${operationPrefix}:prepare`,
            record: {
              artifactApprovalId: approval.id,
              artifactHash: originalInstance.artifactHash,
              runtimeProfileHash: originalInstance.runtimeProfileHash,
              upstreamAuthority: originalInstance.upstreamAuthority,
              placementDecision: {type: "installation", decisionId: decision.id},
              intendedConsumer: consumer,
              intendedRequirement: requirement,
              sharedState: {type: "isolated"},
              runtimeWorkpieceId,
              sourceGatekeeperId: 17,
            },
          });
          impl.storage.contracts.put({
            ...originalRuntimeContract,
            id: runtimeWorkpieceId,
            canonicalInstanceId: prepared.id,
          });
          impl.workspaceAuthority.execute({
            type: "recordProviderBacking",
            operationId: `${operationPrefix}:provider`,
            contractInstanceId: prepared.id,
            expectedInstanceGeneration: 1,
            description: {
              identity: providerIdentity,
              health: "healthy",
              providerNativeScope: {
                resources: ["deployment-r2-bucket"],
                operations: ["head", "get", "list", "put", "delete"],
                recipients: [],
                egress: [],
              },
              providerNativeRevocationGranularity: "deployment-resource",
              localEnforcementRevocationGranularity: "contract-instance-backing",
            },
            result: {
              provider: providerIdentity,
              contractInstance: {id: prepared.id, generation: 1},
              backingReference: `${operationPrefix}:backing`,
              capabilityGeneration: 1,
              state: "prepared",
              cleanup: "not-required",
            },
          });
          const plan = impl.workspaceAuthority.execute({
            type: "planBindingPublication",
            operationId: `${operationPrefix}:publication`,
            contractInstanceId: prepared.id,
            consumer,
            requirement,
            name: "R2_STORAGE",
            verification: {type: "notRequired"},
            expectedBindingGeneration: 0,
            evaluatorPolicyHash: message.policyHash,
          });
          const endpointId = `contract-instance:${prepared.id}`;
          const endpointSnapshot = {
            endpointId,
            instanceId: prepared.id,
            instanceGeneration: 1,
            artifactHash: originalInstance.artifactHash,
            runtimeProfileHash: originalInstance.runtimeProfileHash,
            reachabilityId: `binding:${plan.bindingId}`,
            reachabilityGeneration: 1,
            authoritySnapshotDigest: `sha256:${"e".repeat(64)}`,
            compositionLineage: [endpointId],
            chainDepth: 0,
            maxChainDepth: 8,
          };
          endpoints.set(runtimeWorkpieceId, {snapshot: endpointSnapshot, cancellation: undefined});
          impl.workspaceAuthority.execute({
            type: "acknowledgeBindingEndpoint",
            operationId: `${operationPrefix}:publication`,
            planId: plan.planId,
            snapshot: endpointSnapshot,
            acknowledgement: {endpointId, reachabilityGeneration: 1},
          });
          impl.workspaceAuthority.execute({
            type: "commitBindingPublication",
            operationId: `${operationPrefix}:publication`,
            planId: plan.planId,
          });
          return consumerId;
        };

        const consumerId = materializeConsumer(
          "development-session:1",
          "binding-set:development:1",
          "development-consumer",
        );
        impl.consumerEnvironments.putDevelopmentGrant({
          id: "development-grant-1",
          principalId: "user-id",
          generation: 1,
          projectId: "project-1",
          environmentId: "environment-1",
          bindingSet: {id: "binding-set:development:1", version: 1},
          consumerId,
          consumerGeneration: 1,
          lifecycle: "active",
        });
        const development = await instance.openDevelopment("user-id", "owner-profile");
        const developmentSession = await development.startSession({
          operationId: "development-session-1",
          grantId: "development-grant-1",
          expectedGrantGeneration: 1,
          expectedBindingSet: {id: "binding-set:development:1", version: 1},
        });
        const developmentStatus = await developmentSession.getStatus();
        expect(developmentStatus).toMatchObject({ready: true, leaseGeneration: 1});
        const developmentEnvironment = await developmentSession.openEnvironment(
          developmentStatus.environmentGeneration,
        );
        const developmentBindings = await developmentEnvironment.getBindings();
        expect(developmentBindings.types).toEqual([
          expect.objectContaining({name: "R2_STORAGE", artifactApprovalId: approval.id}),
        ]);
        await expect((developmentBindings.bindings.R2_STORAGE as any).ping())
          .resolves.toBe("pong");
        const renewedStatus = await developmentSession.renew({
          operationId: "development-renew-1",
          expectedConsumerGeneration: 1,
          expectedLeaseGeneration: 1,
        });
        await expect(developmentEnvironment.getBindings()).rejects.toThrow("stale");
        developmentBindings.bindings.R2_STORAGE?.[Symbol.dispose]?.();
        developmentEnvironment[Symbol.dispose]?.();
        developmentSession[Symbol.dispose]?.();
        const resumedSession = await development.resumeSession({
          sessionId: developmentStatus.id,
          expectedConsumerGeneration: 1,
        });
        const resumedEnvironment = await resumedSession.openEnvironment(
          renewedStatus.environmentGeneration,
        );
        const resumedBindings = await resumedEnvironment.getBindings();
        await expect((resumedBindings.bindings.R2_STORAGE as any).ping())
          .resolves.toBe("pong");
        await resumedSession.disconnect({
          operationId: "development-disconnect-1",
          expectedConsumerGeneration: 1,
        });
        await expect(resumedEnvironment.getBindings()).rejects.toThrow("stale");
        resumedBindings.bindings.R2_STORAGE?.[Symbol.dispose]?.();
        resumedEnvironment[Symbol.dispose]?.();
        resumedSession[Symbol.dispose]?.();

        const expiringConsumerId = materializeConsumer(
          "development-session:expiry",
          "binding-set:development:expiry",
          "development-expiry-consumer",
        );
        impl.consumerEnvironments.putDevelopmentGrant({
          id: "development-grant-expiry",
          principalId: "user-id",
          generation: 1,
          projectId: "project-1",
          environmentId: "environment-1",
          bindingSet: {id: "binding-set:development:expiry", version: 1},
          consumerId: expiringConsumerId,
          consumerGeneration: 1,
          lifecycle: "active",
        });
        const expiringSession = await development.startSession({
          operationId: "development-session-expiry",
          grantId: "development-grant-expiry",
          expectedGrantGeneration: 1,
          expectedBindingSet: {id: "binding-set:development:expiry", version: 1},
        });
        const expiringStatus = await expiringSession.getStatus();
        const expiringEnvironment = await expiringSession.openEnvironment(
          expiringStatus.environmentGeneration,
        );
        const expiringBindings = await expiringEnvironment.getBindings();
        await expect((expiringBindings.bindings.R2_STORAGE as any).ping())
          .resolves.toBe("pong");
        const expiryClock = vi.spyOn(Date, "now").mockReturnValue(expiringStatus.expiresAt + 1);
        await impl.expireDueDevelopmentSessions();
        expiryClock.mockRestore();
        await expect(expiringEnvironment.getBindings()).rejects.toThrow("stale");
        expiringBindings.bindings.R2_STORAGE?.[Symbol.dispose]?.();
        expiringEnvironment[Symbol.dispose]?.();
        expiringSession[Symbol.dispose]?.();
        development[Symbol.dispose]?.();

        const workloadConsumerId = materializeConsumer(
          "workload:1",
          "binding-set:workload:1",
          "workload-consumer",
        );
        impl.consumerEnvironments.putWorkload({
          id: "workload-1",
          consumerId: workloadConsumerId,
          consumerGeneration: 1,
          projectId: "project-1",
          environmentId: "environment-1",
          bindingSet: {id: "binding-set:workload:1", version: 1},
          generation: 1,
          lifecycle: "active",
          agentService: {profileId: "manager-agent", role: "manager"},
        });
        impl.consumerEnvironments.putWorkloadRegistration({
          id: "workload-registration-1",
          workloadId: "workload-1",
          adapterId: "cloudflare-service-binding.v1",
          issuer: "cloudflare-account:account-1",
          credentialSubject: "workload-subject-1",
          credentialGeneration: 1,
          generation: 1,
          lifecycle: "active",
        });
        const workloadAttachment = await instance.attachWorkload({
          registrationId: "workload-registration-1",
          adapterId: "cloudflare-service-binding.v1",
          issuer: "cloudflare-account:account-1",
          subject: "workload-subject-1",
          credentialGeneration: 1,
          authenticatedAt: Date.now(),
          expiresAt: Date.now() + 15 * 60_000,
        });
        const workloadStatus = await workloadAttachment.getStatus();
        expect(workloadStatus).toMatchObject({ready: true, workloadGeneration: 1});
        const workloadEnvironment = await workloadAttachment.openEnvironment(
          workloadStatus.environmentGeneration,
        );
        const workloadBindings = await workloadEnvironment.getBindings();
        await expect((workloadBindings.bindings.R2_STORAGE as any).ping())
          .resolves.toBe("pong");
        impl.consumerEnvironments.rotateWorkloadCredential({
          operationId: "workload-rotation-1",
          registrationId: "workload-registration-1",
          expectedGeneration: 1,
          credentialSubject: "workload-subject-2",
          credentialGeneration: 2,
        });
        await expect(workloadEnvironment.getBindings()).resolves.toMatchObject({
          generation: workloadStatus.environmentGeneration,
        });
        impl.consumerEnvironments.finalizeWorkloadCredentialRotation({
          operationId: "workload-rotation-finalize-1",
          registrationId: "workload-registration-1",
          expectedGeneration: 1,
          expectedCredentialGeneration: 2,
        });
        await expect(workloadEnvironment.getBindings()).rejects.toThrow("stale");
        workloadBindings.bindings.R2_STORAGE?.[Symbol.dispose]?.();
        workloadEnvironment[Symbol.dispose]?.();
        workloadAttachment[Symbol.dispose]?.();
        const rotatedAttachment = await instance.attachWorkload({
          registrationId: "workload-registration-1",
          adapterId: "cloudflare-service-binding.v1",
          issuer: "cloudflare-account:account-1",
          subject: "workload-subject-2",
          credentialGeneration: 2,
          authenticatedAt: Date.now(),
          expiresAt: Date.now() + 15 * 60_000,
        });
        const rotatedStatus = await rotatedAttachment.getStatus();
        const rotatedEnvironment = await rotatedAttachment.openEnvironment(
          rotatedStatus.environmentGeneration,
        );
        const rotatedBindings = await rotatedEnvironment.getBindings();
        await expect((rotatedBindings.bindings.R2_STORAGE as any).ping())
          .resolves.toBe("pong");
        await impl.transitionWorkloadConsumer({
          operationId: "workload-retire-1",
          workloadId: "workload-1",
          expectedGeneration: 1,
          lifecycle: "retired",
        });
        await expect(rotatedEnvironment.getBindings()).rejects.toThrow("stale");
        rotatedBindings.bindings.R2_STORAGE?.[Symbol.dispose]?.();
        rotatedEnvironment[Symbol.dispose]?.();
        rotatedAttachment[Symbol.dispose]?.();

        const suspendedConsumerId = materializeConsumer(
          "workload:suspended",
          "binding-set:workload:suspended",
          "workload-suspended-consumer",
        );
        impl.consumerEnvironments.putWorkload({
          id: "workload-suspended",
          consumerId: suspendedConsumerId,
          consumerGeneration: 1,
          projectId: "project-1",
          environmentId: "environment-1",
          bindingSet: {id: "binding-set:workload:suspended", version: 1},
          generation: 1,
          lifecycle: "active",
        });
        impl.consumerEnvironments.putWorkloadRegistration({
          id: "workload-registration-suspended",
          workloadId: "workload-suspended",
          adapterId: "cloudflare-service-binding.v1",
          issuer: "cloudflare-account:account-1",
          credentialSubject: "workload-subject-suspended",
          credentialGeneration: 1,
          generation: 1,
          lifecycle: "active",
        });
        const suspendedAttachment = await instance.attachWorkload({
          registrationId: "workload-registration-suspended",
          adapterId: "cloudflare-service-binding.v1",
          issuer: "cloudflare-account:account-1",
          subject: "workload-subject-suspended",
          credentialGeneration: 1,
          authenticatedAt: Date.now(),
          expiresAt: Date.now() + 15 * 60_000,
        });
        const suspendedStatus = await suspendedAttachment.getStatus();
        const suspendedEnvironment = await suspendedAttachment.openEnvironment(
          suspendedStatus.environmentGeneration,
        );
        const suspendedBindings = await suspendedEnvironment.getBindings();
        await expect((suspendedBindings.bindings.R2_STORAGE as any).ping())
          .resolves.toBe("pong");
        await impl.transitionWorkloadConsumer({
          operationId: "workload-suspend-1",
          workloadId: "workload-suspended",
          expectedGeneration: 1,
          lifecycle: "suspended",
        });
        await expect(suspendedEnvironment.getBindings()).rejects.toThrow("stale");
        suspendedBindings.bindings.R2_STORAGE?.[Symbol.dispose]?.();
        suspendedEnvironment[Symbol.dispose]?.();
        suspendedAttachment[Symbol.dispose]?.();

        const replacementInput = await proposalInput(
          `${COMPILER_STYLE_MODULE}\n// reviewed replacement`,
          undefined,
          {evidence: input.testEvidence, artifactApprovalId: approval.id},
        );
        const replacementProposal = await impl.proposeContract(5, {
          ...replacementInput,
          bindingName: "R2_STORAGE",
        });
        const [replacementBody] = impl.consumeCapturedConnectionRequests(5);
        const replacementMessage: any = {
          chatId: 5,
          sequence: impl.nextChatSequence(5),
          timestamp: impl.getChatTimestamp(),
          author: {type: "agent", id: "model", name: "Agent"},
          ...replacementBody,
        };
        impl.storage.chats.put(replacementMessage);
        await decideArtifact(instance, replacementMessage, "approved");
        const replacementApproval = impl.workspaceAuthority.query({
          type: "artifactApprovalByProposal",
          proposalId: replacementProposal.proposalId,
        }).value;
        const replacementOperation = await authority.beginOperation({
          idempotencyKey: "replace-standing-r2",
          requestDigest: await hashAuthorityRequest({proposalId: replacementProposal.proposalId}),
        });
        const replacementPayload = {
          ...payload,
          operationId: replacementOperation.id,
          requestId: replacementMessage.requestId,
          proposalId: replacementProposal.proposalId,
          artifactApprovalId: replacementApproval.id,
          artifactApprovalEpoch: replacementApproval.approvalEpoch,
          expectedBindingGeneration: 1,
        };
        const replacementResult = await authority.execute({
          ...replacementPayload,
          requestDigest: await hashAuthorityCommand(replacementPayload),
        });
        expect(replacementResult).toMatchObject({
          type: "standingBindingInstalled",
          bindingGeneration: 2,
        });
        expect(impl.workspaceAuthority.query({
          type: "binding",
          id: result.bindingId,
        })).toMatchObject({value: {status: "retracted", generation: 2}});
        expect(impl.workspaceAuthority.query({
          type: "bindingExecutionByInstance",
          contractInstanceId: result.contractInstanceId,
        })).toEqual({type: "bindingExecutionByInstance", value: undefined});

        const blockedProposal = await impl.proposeContract(4, {
          ...await proposalInput(COMPILER_STYLE_MODULE),
          bindingName: "R2_BLOCKED",
        });
        const [blockedBody] = impl.consumeCapturedConnectionRequests(4);
        const blockedMessage: any = {
          chatId: 4,
          sequence: impl.nextChatSequence(4),
          timestamp: impl.getChatTimestamp(),
          author: {type: "agent", id: "model", name: "Agent"},
          ...blockedBody,
        };
        impl.storage.chats.put(blockedMessage);
        await decideArtifact(instance, blockedMessage, "approved");
        const blockedApproval = impl.workspaceAuthority.query({
          type: "artifactApprovalByProposal",
          proposalId: blockedProposal.proposalId,
        }).value;
        impl.describeCanonicalProviderSource = async () => ({
          identity: providerIdentity,
          health: "healthy",
          providerNativeScope: {
            resources: ["deployment-r2-bucket"],
            operations: ["head", "get", "list", "put", "delete"],
            recipients: [],
            egress: ["unmediated-network"],
          },
          providerNativeRevocationGranularity: "deployment-resource",
          localEnforcementRevocationGranularity: "contract-instance-backing",
        });
        const blockedOperation = await authority.beginOperation({
          idempotencyKey: "install-standing-r2-blocked",
          requestDigest: await hashAuthorityRequest({proposalId: blockedProposal.proposalId}),
        });
        const prepareCallsBeforeBlockedInstall = prepareCalls;
        const blockedPayload = {
          ...payload,
          operationId: blockedOperation.id,
          requestId: blockedMessage.requestId,
          proposalId: blockedProposal.proposalId,
          artifactApprovalId: blockedApproval.id,
          artifactApprovalEpoch: blockedApproval.approvalEpoch,
          bindingName: "R2_BLOCKED",
        };
        await expect(authority.execute({
          ...blockedPayload,
          requestDigest: await hashAuthorityCommand(blockedPayload),
        })).rejects.toThrow("Authority Debt exceeds");
        expect(prepareCalls).toBe(prepareCallsBeforeBlockedInstall);
        authority[Symbol.dispose]?.();
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
