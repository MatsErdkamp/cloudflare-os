import {describe, expect, it, vi} from "vitest";

import {
  createWorkspaceAuthorityModule,
  type LegacyGadgetAuthorityRecord,
  type WorkspaceAuthority,
} from "../src/authority/workspace-authority.js";
import type {
  AuthorityDebtId,
  TaskDispatchDecisionId,
  TaskTemplateId,
} from "../src/authority/records.js";
import {makeMockStorage} from "./mock-storage.js";
import {createConsumerEnvironmentAuthority} from "../src/authority/consumer-environments.js";

type TestGadget = LegacyGadgetAuthorityRecord & {title: string};

function publishAcknowledgedBinding(authority: WorkspaceAuthority, input: any) {
  const planned = authority.execute({type: "planBindingPublication", ...input});
  if (planned.type !== "bindingPublicationPlanned") throw new Error("publication not planned");
  const instance = authority.query({type: "contractInstance", id: input.contractInstanceId});
  if (instance.type !== "contractInstance" || !instance.value) throw new Error("instance missing");
  const endpointId = `contract-instance:${instance.value.id}`;
  const snapshot = {
    endpointId,
    instanceId: instance.value.id,
    instanceGeneration: instance.value.generation,
    artifactHash: instance.value.artifactHash,
    runtimeProfileHash: instance.value.runtimeProfileHash,
    reachabilityId: `binding:${planned.bindingId}`,
    reachabilityGeneration: planned.generation,
    authoritySnapshotDigest: `sha256:${"a".repeat(64)}`,
    compositionLineage: [endpointId],
    chainDepth: 0,
    maxChainDepth: 8,
  };
  const acknowledged = authority.execute({
    type: "acknowledgeBindingEndpoint",
    operationId: input.operationId,
    planId: planned.planId,
    snapshot,
    acknowledgement: {endpointId, reachabilityGeneration: planned.generation},
  });
  if (acknowledged.type !== "bindingEndpointAcknowledged") {
    throw new Error("endpoint not acknowledged");
  }
  expect(authority.query({type: "binding", id: planned.bindingId}))
    .toEqual({type: "binding", value: undefined});
  if (acknowledged.invalidationIntentId) {
    const intent = authority.query({type: "invalidationIntentByPlan", planId: planned.planId});
    if (intent.type !== "invalidationIntentByPlan" || !intent.value) {
      throw new Error("invalidation intent missing");
    }
    expect(authority.query({
      type: "bindingExecution",
      consumerId: input.consumer.consumerId,
      name: input.name,
    })).toEqual({type: "bindingExecution", value: undefined});
    expect(authority.query({
      type: "consumerReadiness",
      consumerId: input.consumer.consumerId,
    })).toEqual({
      type: "consumerReadiness",
      value: {ready: false, generation: intent.value.bindingGeneration},
    });
    authority.execute({
      type: "acknowledgeBindingInvalidation",
      operationId: input.operationId,
      planId: planned.planId,
      acknowledgement: {
        endpointId: intent.value.endpointSnapshot.endpointId,
        reachabilityGeneration: intent.value.bindingGeneration,
        invalidated: true,
        cancelledInvocations: 0,
        cleanupFailures: 0,
      },
    });
  }
  return authority.execute({
    type: "commitBindingPublication",
    operationId: input.operationId,
    planId: planned.planId,
  });
}

function commitTerminalInvalidation(authority: WorkspaceAuthority, input: any) {
  const planned = authority.execute({type: "beginBindingInvalidation", ...input});
  if (planned.type !== "bindingInvalidationPlanned") throw new Error("invalidation not planned");
  const binding = authority.query({type: "binding", id: input.bindingId});
  if (binding.type !== "binding" || !binding.value?.endpointSnapshot) {
    throw new Error("binding endpoint missing");
  }
  expect(binding.value.status).not.toBe(input.terminalTarget);
  authority.execute({
    type: "acknowledgeTerminalBindingInvalidation",
    operationId: input.operationId,
    intentId: planned.intentId,
    acknowledgement: {
      endpointId: binding.value.endpointSnapshot.endpointId,
      reachabilityGeneration: binding.value.endpointSnapshot.reachabilityGeneration,
      invalidated: true,
      cancelledInvocations: 0,
      cleanupFailures: 0,
    },
  });
  return authority.execute({
    type: "commitTerminalBindingInvalidation",
    operationId: input.operationId,
    intentId: planned.intentId,
  });
}

function recordArtifactDecision(
  authority: WorkspaceAuthority,
  operationId: string,
  record: any,
) {
  const session = authority.openSession("test-owner", true);
  if (!session) throw new Error("owner authority unavailable");
  const operation = authority.beginOperation(session, operationId, `sha256:${"d".repeat(64)}`);
  const {
    evidence: _evidence,
    decidedBy: _decidedBy,
    lifecycle: _lifecycle,
    decision,
    permissionGeneration: _permissionGeneration,
    ...proposalEvidence
  } = record;
  const command = {
    type: "decideArtifactProposal" as const,
    operationId: operation.id,
    stepKey: "artifact-decision",
    requestDigest: operationId,
    expectedAuthorityEpoch: session.authorityEpoch,
    expectedPermissionGeneration: session.permissionGeneration,
    expectedProposalRevision: 1,
    requestId: `test:${operationId}`,
    evidence: proposalEvidence,
    decision,
  };
  return authority.decideArtifactProposal(session, command, operationId);
}

function makeModule({
  legacyPlacement = false,
  legacyTombstone = false,
  durableStorage = makeMockStorage(),
}: {
  legacyPlacement?: boolean;
  legacyTombstone?: boolean;
  durableStorage?: ReturnType<typeof makeMockStorage>;
} = {}) {
  const gadgets = new Map<number, TestGadget>([
    [1, {
      id: 1,
      title: "Consumer",
      bindings: legacyPlacement ? {FILES: {target: 10}} : {},
    }],
    [2, {id: 2, title: "Other", bindings: {}}],
  ]);
  const contracts = new Set([10]);
  const legacyContracts = new Map(legacyPlacement ? [[10, {
    id: 10,
    artifactHash: `sha256:${"a".repeat(64)}`,
    runtimeProfileHash: `sha256:${"b".repeat(64)}`,
    sourceGatekeeperId: 20,
    approvedBy: "legacy-reviewer",
  }]] : []);
  const legacyContractTombstones = new Map(legacyTombstone ? [[11, {
    id: 11,
    artifactHash: `sha256:${"c".repeat(64)}`,
    runtimeProfileHash: `sha256:${"d".repeat(64)}`,
    sourceGatekeeperId: 20,
    approvedBy: "legacy-reviewer",
  }]] : []);
  const gatekeepers = new Set([20]);
  const bumped: number[][] = [];
  const adapter = {
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
    getContract(id) {
      return legacyContracts.get(id);
    },
    listContracts() {
      return legacyContracts.values();
    },
    getContractTombstone(id) {
      return legacyContractTombstones.get(id);
    },
    listContractTombstones() {
      return legacyContractTombstones.values();
    },
    retractContract(id) {
      const affected: number[] = [];
      for (const gadget of gadgets.values()) {
        const entries = Object.entries(gadget.bindings);
        const retained = entries.filter(([, binding]) => binding.target !== id);
        if (retained.length === entries.length) continue;
        gadget.bindings = Object.fromEntries(retained);
        gadgets.set(gadget.id, structuredClone(gadget));
        affected.push(gadget.id);
      }
      const contract = legacyContracts.get(id);
      if (contract) legacyContractTombstones.set(id, contract);
      legacyContracts.delete(id);
      contracts.delete(id);
      return affected;
    },
    bumpConsumers(ids) {
      bumped.push([...ids]);
    },
  };
  const module = createWorkspaceAuthorityModule(durableStorage, adapter);
  return {module, gadgets, bumped, durableStorage, adapter};
}

describe("Workspace Authority module", () => {
  it("rejects incomplete or malformed evidence for a new Artifact Approval", () => {
    const {module} = makeModule();
    module.authority.execute({type: "initialize"});
    module.authority.execute({type: "beginBackfill", migrationId: "evidence-migration"});
    const candidate = module.authority.query({type: "cutoverCandidate"});
    if (candidate.type !== "cutoverCandidate") throw new Error("candidate unavailable");
    module.authority.execute({type: "markReadyToCutover", expectedDigest: candidate.value.digest});
    module.authority.execute({type: "cutover", expectedDigest: candidate.value.digest});
    const proposal = module.authority.execute({
      type: "recordArtifactProposal",
      operationId: "record-proposal-1",
      record: {
        artifactHash: `sha256:${"1".repeat(64)}`,
        runtimeProfileHash: `sha256:${"6".repeat(64)}`,
        reviewBundleHash: `sha256:${"2".repeat(64)}`,
        reviewComparisonHash: `sha256:${"3".repeat(64)}`,
        policyHash: `sha256:${"4".repeat(64)}`,
        baseline: {type: "none"},
        generatorIdentityHash: `sha256:${"5".repeat(64)}`,
        proposedBy: "author",
        proposedAt: 1,
      },
    });
    if (proposal.type !== "artifactProposalRecorded") throw new Error("proposal unavailable");
    const valid = {
      artifactHash: `sha256:${"1".repeat(64)}`,
      proposalId: proposal.id,
      reviewBundleHash: `sha256:${"2".repeat(64)}`,
      reviewComparisonHash: `sha256:${"3".repeat(64)}`,
      policyHash: `sha256:${"4".repeat(64)}`,
      baseline: {type: "none" as const},
      generatorIdentityHash: `sha256:${"5".repeat(64)}`,
      evidence: "complete" as const,
      decision: "approved" as const,
      decidedBy: "reviewer",
      lifecycle: "active" as const,
    };

    expect(() => recordArtifactDecision(
      module.authority,
      "malformed-evidence",
      {...valid, reviewBundleHash: "not-content-addressed"},
    )).toThrow("Review Bundle hash must be a sha256 content hash");
    expect(() => recordArtifactDecision(
      module.authority,
      "empty-proposal",
      {...valid, proposalId: ""},
    )).toThrow("Artifact Proposal ID is required");
    expect(() => recordArtifactDecision(
      module.authority,
      "mismatched-evidence",
      {...valid, policyHash: `sha256:${"f".repeat(64)}`},
    )).toThrow("Artifact Approval evidence does not match its Proposal");

    const approval = recordArtifactDecision(module.authority, "complete-evidence", valid);
    expect(approval).toMatchObject({type: "artifactApprovalRecorded"});
    expect(module.authority.query({type: "artifactProposal", id: proposal.id})).toMatchObject({
      type: "artifactProposal",
      value: {state: "accepted", revision: 2},
    });
    expect(() => recordArtifactDecision(module.authority, "duplicate-epoch", valid)).toThrow();

    const reapprovalProposal = module.authority.execute({
      type: "recordArtifactProposal",
      operationId: "record-proposal-2",
      record: {
        artifactHash: valid.artifactHash,
        runtimeProfileHash: `sha256:${"6".repeat(64)}`,
        reviewBundleHash: valid.reviewBundleHash,
        reviewComparisonHash: valid.reviewComparisonHash,
        policyHash: valid.policyHash,
        baseline: {type: "none"},
        generatorIdentityHash: valid.generatorIdentityHash,
        proposedBy: "author",
        proposedAt: 2,
      },
    });
    if (reapprovalProposal.type !== "artifactProposalRecorded") {
      throw new Error("reapproval proposal unavailable");
    }
    const reapproval = recordArtifactDecision(
      module.authority,
      "reapproval",
      {...valid, proposalId: reapprovalProposal.id},
    );
    expect(reapproval).toMatchObject({type: "artifactApprovalRecorded", approvalEpoch: 2});
    expect(module.authority.query({
      type: "artifactApprovalByProposal",
      proposalId: reapprovalProposal.id,
    })).toMatchObject({type: "artifactApprovalByProposal", value: {approvalEpoch: 2}});

    const rejectedProposal = module.authority.execute({
      type: "recordArtifactProposal",
      operationId: "record-proposal-rejected",
      record: {
        artifactHash: valid.artifactHash,
        runtimeProfileHash: `sha256:${"6".repeat(64)}`,
        reviewBundleHash: valid.reviewBundleHash,
        reviewComparisonHash: valid.reviewComparisonHash,
        policyHash: valid.policyHash,
        baseline: {type: "none"},
        generatorIdentityHash: valid.generatorIdentityHash,
        proposedBy: "author",
        proposedAt: 3,
      },
    });
    if (rejectedProposal.type !== "artifactProposalRecorded") {
      throw new Error("rejected proposal unavailable");
    }
    expect(recordArtifactDecision(
      module.authority,
      "rejection",
      {
        ...valid,
        proposalId: rejectedProposal.id,
        decision: "rejected",
        lifecycle: "revoked",
      },
    )).toMatchObject({type: "artifactApprovalRecorded", approvalEpoch: 3});
    expect(module.authority.query({type: "artifactProposal", id: rejectedProposal.id}))
      .toMatchObject({type: "artifactProposal", value: {state: "rejected"}});
  });

  it("initializes and reports authority state through its production command/query interface", () => {
    const {module} = makeModule();

    expect(module.authority.query({type: "status"})).toEqual({
      type: "status",
      value: {
        state: "uninitialized",
        revision: 0,
        eventHighWatermark: 0,
        pendingEffects: 0,
        pendingMigrationDeltas: 0,
      },
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
      type: "status",
      value: {
        state: "legacy",
        revision: 1,
        eventHighWatermark: 1,
        pendingEffects: 0,
        pendingMigrationDeltas: 0,
      },
    });
    expect(module.authority.reconcile()).toEqual({attemptedEffects: 0});
  });

  it("keeps existing binding behavior behind the explicit compatibility interface", () => {
    const {module, gadgets, bumped} = makeModule();
    module.authority.execute({type: "initialize"});

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

  it("keeps Approval, Decision, Resolution, Instance, and Binding separate through CAS publication", () => {
    const {module} = makeModule();
    module.authority.execute({type: "initialize"});
    const mappedConsumer = module.authority.execute({
      type: "mapLegacyConsumer",
      legacyWorkpieceId: 1,
    });
    const retriedConsumer = module.authority.execute({
      type: "mapLegacyConsumer",
      legacyWorkpieceId: 1,
    });
    const mappedSource = module.authority.execute({
      type: "mapLegacySource",
      legacyWorkpieceId: 20,
    });
    const mappedRequirement = module.authority.execute({
      type: "mapLegacyRequirement",
      legacyKey: "1:FILES",
    });
    if (mappedConsumer.type !== "legacyConsumerMapped" ||
        retriedConsumer.type !== "legacyConsumerMapped" ||
        mappedSource.type !== "legacySourceMapped" ||
        mappedRequirement.type !== "legacyRequirementMapped") {
      throw new Error("unexpected identity mapping result");
    }
    expect(retriedConsumer.id).toBe(mappedConsumer.id);
    const consumer = {type: "standing" as const, consumerId: mappedConsumer.id, generation: 1};
    const requirement = {
      type: "environment" as const,
      bindingSetId: "binding-set-files",
      bindingSetVersion: 1,
      requirementId: mappedRequirement.id,
      requirementVersion: 1,
    };
    const upstreamAuthority = {
      sourceId: mappedSource.id,
      sourceGeneration: 1,
      origin: {type: "workspaceAccount" as const, id: "account-1", generation: 1},
    };

    module.authority.execute({type: "beginBackfill", migrationId: "empty-migration"});
    const candidate = module.authority.query({type: "cutoverCandidate"});
    if (candidate.type !== "cutoverCandidate") throw new Error("candidate unavailable");
    module.authority.execute({
      type: "markReadyToCutover",
      expectedDigest: candidate.value.digest,
    });
    module.authority.execute({type: "cutover", expectedDigest: candidate.value.digest});

    const standingProposal = module.authority.execute({
      type: "recordArtifactProposal",
      operationId: "proposal-standing",
      record: {
        artifactHash: `sha256:${"1".repeat(64)}`,
        runtimeProfileHash: `sha256:${"3".repeat(64)}`,
        reviewBundleHash: `sha256:${"2".repeat(64)}`,
        reviewComparisonHash: `sha256:${"3".repeat(64)}`,
        policyHash: `sha256:${"4".repeat(64)}`,
        baseline: {type: "none"},
        generatorIdentityHash: `sha256:${"5".repeat(64)}`,
        proposedBy: "legacy-attribution",
        proposedAt: 1,
      },
    });
    if (standingProposal.type !== "artifactProposalRecorded") {
      throw new Error("standing proposal unavailable");
    }
    const approval = recordArtifactDecision(
      module.authority,
      "operation-approval",
      {
        artifactHash: `sha256:${"1".repeat(64)}`,
        proposalId: standingProposal.id,
        reviewBundleHash: `sha256:${"2".repeat(64)}`,
        reviewComparisonHash: `sha256:${"3".repeat(64)}`,
        policyHash: `sha256:${"4".repeat(64)}`,
        baseline: {type: "none"},
        generatorIdentityHash: `sha256:${"5".repeat(64)}`,
        evidence: "complete",
        decision: "approved",
        decidedBy: "legacy-attribution",
        lifecycle: "active",
      },
    );
    if (approval.type !== "artifactApprovalRecorded") throw new Error("approval not recorded");
    const decision = module.authority.execute({
      type: "recordInstallationDecision",
      operationId: "operation-installation",
      record: {
        proposalDigest: `sha256:${"2".repeat(64)}`,
        decision: "approved",
        decidedBy: "legacy-attribution",
        consumer,
        requirement,
        intendedBindingName: "FILES",
        expectedBindingGeneration: 0,
      },
    });
    if (decision.type !== "installationDecisionRecorded") throw new Error("decision not recorded");
    const prepared = module.authority.execute({
      type: "prepareContractInstance",
      operationId: "operation-prepare",
      record: {
        artifactApprovalId: approval.id,
        artifactHash: `sha256:${"1".repeat(64)}`,
        runtimeProfileHash: `sha256:${"3".repeat(64)}`,
        upstreamAuthority,
        placementDecision: {type: "installation", decisionId: decision.id},
        intendedConsumer: consumer,
        intendedRequirement: requirement,
        sharedState: {type: "isolated"},
        runtimeWorkpieceId: 10,
        sourceGatekeeperId: 20,
      },
    });
    if (prepared.type !== "contractInstancePrepared") throw new Error("instance not prepared");
    const providerIdentity = {
      providerId: "cloudflare-r2",
      accountId: "account-1",
      sourceId: "r2-root",
      sourceGeneration: 1,
    };
    module.authority.execute({
      type: "recordProviderBacking",
      operationId: "provider-prepare",
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
        backingReference: "opaque-backing",
        capabilityGeneration: 1,
        state: "prepared",
        cleanup: "not-required",
      },
    });
    const published = publishAcknowledgedBinding(module.authority, {
      operationId: "operation-publish",
      contractInstanceId: prepared.id,
      consumer,
      requirement,
      name: "FILES",
      verification: {type: "notRequired"},
      expectedBindingGeneration: 0,
      evaluatorPolicyHash: `sha256:${"4".repeat(64)}`,
    });
    if (published.type !== "bindingPublished") throw new Error("binding not published");
    expect(published.generation).toBe(1);

    const instanceView = module.authority.query({type: "contractInstance", id: prepared.id});
    const bindingView = module.authority.query({type: "binding", id: published.bindingId});
    const resolutionView = module.authority.query({
      type: "bindingResolution",
      id: published.resolutionId,
    });
    expect(instanceView).toMatchObject({
      type: "contractInstance",
      value: {id: prepared.id, lifecycle: "ready", artifactApprovalId: approval.id},
    });
    expect(bindingView).toMatchObject({
      type: "binding",
      value: {
        id: published.bindingId,
        contractInstanceId: prepared.id,
        resolutionId: published.resolutionId,
        status: "active",
        generation: 1,
      },
    });
    expect(resolutionView).toEqual({
      type: "bindingResolution",
      value: expect.objectContaining({
        consumer,
        requirement,
        upstreamAuthority,
        verification: {type: "notRequired"},
        artifactApprovalId: approval.id,
        placementDecision: {type: "installation", decisionId: decision.id},
        contractInstanceId: prepared.id,
        bindingId: published.bindingId,
        expectedBindingGeneration: 0,
      }),
    });
    expect(module.authority.query({
      type: "bindingExecutionByRuntimeWorkpiece",
      runtimeWorkpieceId: 10,
    })).toMatchObject({
      type: "bindingExecutionByRuntimeWorkpiece",
      value: {
        binding: {id: published.bindingId, status: "active"},
        instance: {id: prepared.id, runtimeWorkpieceId: 10, lifecycle: "ready"},
      },
    });

    expect(() => publishAcknowledgedBinding(module.authority, {
      operationId: "stale-publish",
      contractInstanceId: prepared.id,
      consumer,
      requirement,
      name: "FILES",
      verification: {type: "notRequired"},
      expectedBindingGeneration: 0,
      evaluatorPolicyHash: `sha256:${"4".repeat(64)}`,
    })).toThrow("Stale Binding generation");

    const runtimeRequest = module.authority.execute({
      type: "requestRuntimeApproval",
      operationId: "runtime-request",
      record: {
        bindingId: published.bindingId,
        bindingGeneration: 1,
        invocationId: "invocation-1",
        operation: "writeFile",
        requestedAt: 1,
        expiresAt: 2,
      },
    });
    if (runtimeRequest.type !== "runtimeApprovalRequested") {
      throw new Error("runtime approval not requested");
    }
    const runtimeDecision = module.authority.execute({
      type: "decideRuntimeApproval",
      operationId: "runtime-decision",
      record: {
        requestId: runtimeRequest.id,
        decision: "released",
        decidedBy: "reviewer",
        decidedAt: 1,
      },
    });
    if (runtimeDecision.type !== "runtimeApprovalDecided") {
      throw new Error("runtime approval not decided");
    }
    const debt = module.authority.execute({
      type: "recordAuthorityDebt",
      operationId: "authority-debt",
      record: {
        bindingId: published.bindingId,
        upstreamAuthority,
        providerNativeScope: {
          provider: "legacy-provider",
          resources: ["workspace"],
          operations: ["read", "write"],
          recipients: ["provider"],
          egress: ["provider-api"],
        },
        effectiveScope: {
          provider: "legacy-provider",
          resources: ["workspace/file.txt"],
          operations: ["read"],
          recipients: ["model"],
          egress: [],
        },
        enforcementLayer: "contract",
        revocationGranularity: "binding-generation",
        risk: "medium",
        exceptionOwner: "workspace-owner",
        productionEligibility: "exceptionRequired",
        remediation: "replace with a provider-native file scope",
        lifecycle: "open",
      },
    });
    if (debt.type !== "authorityDebtRecorded") throw new Error("debt not recorded");
    expect(module.authority.query({type: "runtimeApprovalDecision", id: runtimeDecision.id}))
      .toMatchObject({type: "runtimeApprovalDecision", value: {requestId: runtimeRequest.id}});
    expect(module.authority.query({type: "authorityDebt", id: debt.id}))
      .toMatchObject({
        type: "authorityDebt",
        value: {
          providerNativeScope: {operations: ["read", "write"]},
          effectiveScope: {operations: ["read"]},
          enforcementLayer: "contract",
          revocationGranularity: "binding-generation",
          risk: "medium",
          exceptionOwner: "workspace-owner",
          productionEligibility: "exceptionRequired",
          remediation: "replace with a provider-native file scope",
        },
      });

    const replacementDecision = module.authority.execute({
      type: "recordInstallationDecision",
      operationId: "replacement-decision",
      record: {
        proposalDigest: `sha256:${"5".repeat(64)}`,
        decision: "approved",
        decidedBy: "reviewer",
        consumer,
        requirement,
        intendedBindingName: "FILES",
        expectedBindingGeneration: 1,
      },
    });
    if (replacementDecision.type !== "installationDecisionRecorded") {
      throw new Error("replacement decision not recorded");
    }
    const replacementInstance = module.authority.execute({
      type: "prepareContractInstance",
      operationId: "replacement-instance",
      record: {
        artifactApprovalId: approval.id,
        artifactHash: `sha256:${"1".repeat(64)}`,
        runtimeProfileHash: `sha256:${"3".repeat(64)}`,
        upstreamAuthority,
        placementDecision: {type: "installation", decisionId: replacementDecision.id},
        intendedConsumer: consumer,
        intendedRequirement: requirement,
        sharedState: {type: "isolated"},
        predecessorId: prepared.id,
        runtimeWorkpieceId: 11,
        sourceGatekeeperId: 20,
      },
    });
    if (replacementInstance.type !== "contractInstancePrepared") {
      throw new Error("replacement instance not prepared");
    }
    const replacement = publishAcknowledgedBinding(module.authority, {
      operationId: "replacement-publish",
      contractInstanceId: replacementInstance.id,
      consumer,
      requirement,
      name: "FILES",
      verification: {type: "notRequired"},
      expectedBindingGeneration: 1,
      evaluatorPolicyHash: `sha256:${"4".repeat(64)}`,
    });
    if (replacement.type !== "bindingPublished") throw new Error("replacement not published");
    expect(replacement).toMatchObject({generation: 2});
    expect(module.authority.query({
      type: "consumerReadiness",
      consumerId: consumer.consumerId,
    })).toEqual({type: "consumerReadiness", value: {ready: true, generation: 2}});
    expect(module.authority.query({type: "binding", id: published.bindingId}))
      .toMatchObject({type: "binding", value: {status: "retracted", generation: 2}});
    expect(module.authority.query({type: "contractInstance", id: prepared.id}))
      .toMatchObject({type: "contractInstance", value: {lifecycle: "retracted", generation: 2}});
    expect(module.authority.query({
      type: "contractInstanceByRuntimeWorkpiece",
      runtimeWorkpieceId: 10,
    })).toMatchObject({
      type: "contractInstanceByRuntimeWorkpiece",
      value: {id: prepared.id, lifecycle: "retracted", generation: 2},
    });
    expect(module.authority.query({
      type: "authorityTombstoneBySubject",
      subjectType: "contractInstance",
      subjectId: prepared.id,
    })).toMatchObject({
      type: "authorityTombstoneBySubject",
      value: {terminalReason: "binding-replaced", cleanup: "pending"},
    });
    expect(module.authority.query({type: "binding", id: replacement.bindingId}))
      .toMatchObject({
        type: "binding",
        value: {status: "active", generation: 2, predecessorId: published.bindingId},
      });
    expect(module.compatibility.queryBindingLineage({consumerId: 1})).toEqual([
      ["FILES", {target: 11}],
      ["FILES", {target: 10}],
    ]);
    expect(module.authority.query({type: "status"})).toMatchObject({
      value: {pendingEffects: 1},
    });
    const [cleanup] = module.authority.claimDueEffects(1, 16, () => "claim-1");
    expect(cleanup).toMatchObject({
      kind: "cleanupProviderBacking",
      targetId: prepared.id,
      expectedCapabilityGeneration: 1,
      deactivationOperationId: `operation-installation:provider-deactivate:${prepared.id}`,
      state: "claimed",
      cleanupResponsibility: true,
    });
    module.authority.retryEffect(cleanup!.id, "claim-1", 1);
    expect(module.authority.claimDueEffects(1, 16, () => "too-early")).toEqual([]);
    const [retriedCleanup] = module.authority.claimDueEffects(
      Number.MAX_SAFE_INTEGER,
      16,
      () => "claim-2",
    );
    module.authority.completeEffect(retriedCleanup!.id, "claim-2");
    expect(module.authority.query({
      type: "authorityTombstoneBySubject",
      subjectType: "contractInstance",
      subjectId: prepared.id,
    })).toMatchObject({value: {cleanup: "complete"}});

    const suspended = commitTerminalInvalidation(module.authority, {
      operationId: "suspend-binding",
      bindingId: replacement.bindingId,
      expectedGeneration: 2,
      terminalTarget: "suspended",
      reason: "upstream-health-unknown",
    });
    expect(suspended).toMatchObject({type: "bindingSuspended", generation: 3});
    expect(module.authority.query({type: "contractInstance", id: replacementInstance.id}))
      .toMatchObject({type: "contractInstance", value: {lifecycle: "suspended", generation: 2}});
    expect(module.compatibility.queryBindingLineage({consumerId: 1})).toEqual([
      ["FILES", {target: 11}],
      ["FILES", {target: 10}],
    ]);
    expect(() => module.authority.execute({
      type: "requestRuntimeApproval",
      operationId: "stale-runtime-request",
      record: {
        bindingId: replacement.bindingId,
        bindingGeneration: 2,
        invocationId: "invocation-2",
        operation: "writeFile",
        requestedAt: 2,
        expiresAt: 3,
      },
    })).toThrow("stale or inactive Binding");
    const retracted = commitTerminalInvalidation(module.authority, {
      operationId: "retract-binding",
      bindingId: replacement.bindingId,
      expectedGeneration: 3,
      terminalTarget: "retracted",
      reason: "explicit-retraction",
    });
    expect(retracted).toMatchObject({type: "bindingRetracted", generation: 4});
    expect(module.authority.query({type: "contractInstance", id: replacementInstance.id}))
      .toMatchObject({type: "contractInstance", value: {lifecycle: "retracted", generation: 3}});
    expect(module.authority.query({
      type: "authorityTombstoneBySubject",
      subjectType: "contractInstance",
      subjectId: replacementInstance.id,
    })).toMatchObject({
      type: "authorityTombstoneBySubject",
      value: {terminalReason: "explicit-retraction", cleanup: "pending"},
    });
    expect(module.authority.query({
      type: "authorityTombstoneBySubject",
      subjectType: "binding",
      subjectId: replacement.bindingId,
    })).toMatchObject({
      type: "authorityTombstoneBySubject",
      value: {
        subject: {type: "binding", id: replacement.bindingId},
        terminalReason: "explicit-retraction",
        cleanup: "pending",
      },
    });
  });

  it("requires one approved durable Task Dispatch Decision for task placement", () => {
    const {module, durableStorage} = makeModule();
    module.authority.execute({type: "initialize"});
    const mappedConsumer = module.authority.execute({
      type: "mapLegacyConsumer",
      legacyWorkpieceId: 1,
    });
    const mappedSource = module.authority.execute({type: "mapLegacySource", legacyWorkpieceId: 20});
    const mappedRequirement = module.authority.execute({
      type: "mapLegacyRequirement",
      legacyKey: "task:FILES",
    });
    const mappedRequirementTwo = module.authority.execute({
      type: "mapLegacyRequirement",
      legacyKey: "task:CACHE",
    });
    if (mappedConsumer.type !== "legacyConsumerMapped" ||
        mappedSource.type !== "legacySourceMapped" ||
        mappedRequirement.type !== "legacyRequirementMapped" ||
        mappedRequirementTwo.type !== "legacyRequirementMapped") {
      throw new Error("task authority identities not mapped");
    }
    module.authority.execute({type: "beginBackfill", migrationId: "task-migration"});
    const candidate = module.authority.query({type: "cutoverCandidate"});
    if (candidate.type !== "cutoverCandidate") throw new Error("candidate unavailable");
    module.authority.execute({type: "markReadyToCutover", expectedDigest: candidate.value.digest});
    module.authority.execute({type: "cutover", expectedDigest: candidate.value.digest});

    const taskProposal = module.authority.execute({
      type: "recordArtifactProposal",
      operationId: "proposal-task",
      record: {
        artifactHash: `sha256:${"6".repeat(64)}`,
        runtimeProfileHash: `sha256:${"b".repeat(64)}`,
        reviewBundleHash: `sha256:${"7".repeat(64)}`,
        reviewComparisonHash: `sha256:${"8".repeat(64)}`,
        policyHash: `sha256:${"9".repeat(64)}`,
        baseline: {type: "none"},
        generatorIdentityHash: `sha256:${"a".repeat(64)}`,
        proposedBy: "reviewer",
        proposedAt: 1,
      },
    });
    if (taskProposal.type !== "artifactProposalRecorded") {
      throw new Error("task proposal unavailable");
    }
    const approval = recordArtifactDecision(
      module.authority,
      "task-artifact-approval",
      {
        artifactHash: `sha256:${"6".repeat(64)}`,
        proposalId: taskProposal.id,
        reviewBundleHash: `sha256:${"7".repeat(64)}`,
        reviewComparisonHash: `sha256:${"8".repeat(64)}`,
        policyHash: `sha256:${"9".repeat(64)}`,
        baseline: {type: "none"},
        generatorIdentityHash: `sha256:${"a".repeat(64)}`,
        evidence: "complete",
        decision: "approved",
        decidedBy: "reviewer",
        lifecycle: "active",
      },
    );
    if (approval.type !== "artifactApprovalRecorded") throw new Error("approval unavailable");
    const taskTemplateId = "task-template-files" as TaskTemplateId;
    const consumer = {
      type: "agentTask" as const,
      consumerId: mappedConsumer.id,
      taskId: "task-1",
      taskGeneration: 1,
    };
    const requirement = {
      type: "taskTemplate" as const,
      taskTemplateId,
      taskTemplateVersion: 1,
      requirementId: mappedRequirement.id,
    };
    const requirementTwo = {
      ...requirement,
      requirementId: mappedRequirementTwo.id,
    };
    const instanceRecord = {
      artifactApprovalId: approval.id,
      artifactHash: `sha256:${"6".repeat(64)}`,
      runtimeProfileHash: `sha256:${"7".repeat(64)}`,
      upstreamAuthority: {
        sourceId: mappedSource.id,
        sourceGeneration: 1,
        origin: {type: "workspaceAccount" as const, id: "account-1", generation: 1},
      },
      intendedConsumer: consumer,
      intendedRequirement: requirement,
      sharedState: {type: "isolated" as const},
    };
    expect(() => module.authority.execute({
      type: "prepareContractInstance",
      operationId: "missing-task-dispatch",
      record: {
        ...instanceRecord,
        placementDecision: {
          type: "taskDispatch",
          decisionId: "missing-task-dispatch" as TaskDispatchDecisionId,
        },
      },
    })).toThrow("Task Dispatch Decision is not approved");

    const dispatchRecord = {
      taskId: "task-1",
      taskGeneration: 1,
      taskTemplateId,
      taskTemplateVersion: 1,
      taskTemplateApprovalId: "task-template-approval-1",
      consumer,
      requirements: [requirement, requirementTwo],
      effectiveAuthorityEnvelopeHash: `sha256:${"8".repeat(64)}`,
      initiatingPrincipal: {id: "principal-1", generation: 1},
      agentServiceWorkloadId: "workload-1",
      agentServiceWorkloadGeneration: 1,
      agentServiceProfileId: "agent-service-profile-1",
      agentServiceProfileGeneration: 1,
      workloadRegistrationId: "registration-1",
      workloadRegistrationGeneration: 1,
      eligibilityEvidence: [requirement, requirementTwo].map(candidate => ({
        requirementId: candidate.requirementId,
        upstreamAuthority: instanceRecord.upstreamAuthority,
        providerCapabilityGeneration: 1,
        verification: {type: "notRequired" as const},
        evaluatorPolicyHash: `sha256:${"9".repeat(64)}`,
        authorityDebtId: "task-test-debt" as AuthorityDebtId,
        authorityDebtRevision: 1,
        egress: [] as [],
      })),
      absoluteExpiry: Date.now() + 60_000,
      decision: "approved" as const,
      decidedBy: "dispatcher",
    };
    expect(() => module.authority.execute({
      type: "recordTaskDispatchDecision",
      operationId: "mismatched-task-dispatch",
      record: {...dispatchRecord, taskId: "task-2"},
    })).toThrow("Consumer differs from its task lineage");
    expect(() => module.authority.execute({
      type: "recordTaskDispatchDecision",
      operationId: "empty-task-dispatch",
      record: {...dispatchRecord, requirements: []},
    })).toThrow("requirements differ from its Task Template");
    expect(() => module.authority.execute({
      type: "recordTaskDispatchDecision",
      operationId: "expired-task-dispatch",
      record: {...dispatchRecord, absoluteExpiry: Date.now() - 1},
    })).toThrow("already expired");
    const recordedAt = Date.now();
    const expiringDispatch = module.authority.execute({
      type: "recordTaskDispatchDecision",
      operationId: "expiring-task-dispatch",
      record: {...dispatchRecord, absoluteExpiry: recordedAt + 1_000},
    });
    if (expiringDispatch.type !== "taskDispatchDecisionRecorded") {
      throw new Error("expiring dispatch unavailable");
    }
    const clock = vi.spyOn(Date, "now").mockReturnValue(recordedAt + 2_000);
    try {
      expect(() => module.authority.execute({
        type: "prepareContractInstance",
        operationId: "expired-before-placement",
        record: {
          ...instanceRecord,
          placementDecision: {type: "taskDispatch", decisionId: expiringDispatch.id},
        },
      })).toThrow("Task Dispatch Decision is expired");
    } finally {
      clock.mockRestore();
    }
    const dispatch = module.authority.execute({
      type: "recordTaskDispatchDecision",
      operationId: "task-dispatch",
      record: dispatchRecord,
    });
    if (dispatch.type !== "taskDispatchDecisionRecorded") throw new Error("dispatch unavailable");
    const prepared = module.authority.execute({
      type: "prepareContractInstance",
      operationId: "task-instance",
      record: {
        ...instanceRecord,
        placementDecision: {type: "taskDispatch", decisionId: dispatch.id},
      },
    });
    if (prepared.type !== "contractInstancePrepared") throw new Error("instance unavailable");
    const preparedTwo = module.authority.execute({
      type: "prepareContractInstance",
      operationId: "task-instance-two",
      record: {
        ...instanceRecord,
        intendedRequirement: requirementTwo,
        placementDecision: {type: "taskDispatch", decisionId: dispatch.id},
      },
    });
    expect(preparedTwo).toMatchObject({type: "contractInstancePrepared"});
    if (preparedTwo.type === "contractInstancePrepared") expect(preparedTwo.id).not.toBe(prepared.id);
    const publishClock = vi.spyOn(Date, "now")
      .mockReturnValue(dispatchRecord.absoluteExpiry + 1);
    try {
      expect(() => publishAcknowledgedBinding(module.authority, {
        operationId: "expired-before-publish",
        contractInstanceId: prepared.id,
        consumer,
        requirement,
        name: "FILES",
        verification: {type: "notRequired"},
        expectedBindingGeneration: 0,
        evaluatorPolicyHash: `sha256:${"9".repeat(64)}`,
      })).toThrow("Task Dispatch Decision is expired");
    } finally {
      publishClock.mockRestore();
    }
    const published = publishAcknowledgedBinding(module.authority, {
      operationId: "task-binding",
      contractInstanceId: prepared.id,
      consumer,
      requirement,
      name: "FILES",
      verification: {type: "notRequired"},
      expectedBindingGeneration: 0,
      evaluatorPolicyHash: `sha256:${"9".repeat(64)}`,
    });
    if (published.type !== "bindingPublished") throw new Error("task Binding unavailable");
    expect(module.authority.query({type: "bindingResolution", id: published.resolutionId}))
      .toMatchObject({
        type: "bindingResolution",
        value: {placementDecision: {type: "taskDispatch", decisionId: dispatch.id}},
      });

    const standingConsumer = {
      type: "standing" as const,
      consumerId: mappedConsumer.id,
      generation: 1,
    };
    const standingRequirement = {
      type: "environment" as const,
      bindingSetId: "agent-service-bindings",
      bindingSetVersion: 1,
      requirementId: mappedRequirement.id,
      requirementVersion: 1,
    };
    const installation = module.authority.execute({
      type: "recordInstallationDecision",
      operationId: "agent-service-installation",
      record: {
        proposalDigest: `sha256:${"b".repeat(64)}`,
        decision: "approved",
        decidedBy: "reviewer",
        consumer: standingConsumer,
        requirement: standingRequirement,
        intendedBindingName: "R2_STORAGE",
        expectedBindingGeneration: 0,
      },
    });
    if (installation.type !== "installationDecisionRecorded") {
      throw new Error("agent service installation unavailable");
    }
    const standingInstance = module.authority.execute({
      type: "prepareContractInstance",
      operationId: "agent-service-instance",
      record: {
        ...instanceRecord,
        placementDecision: {type: "installation", decisionId: installation.id},
        intendedConsumer: standingConsumer,
        intendedRequirement: standingRequirement,
        runtimeWorkpieceId: 22,
        sourceGatekeeperId: 20,
      },
    });
    if (standingInstance.type !== "contractInstancePrepared") {
      throw new Error("agent service instance unavailable");
    }
    const providerIdentity = {
      providerId: "cloudflare-r2",
      accountId: "account-1",
      sourceId: "r2-root",
      sourceGeneration: 1,
    };
    module.authority.execute({
      type: "recordProviderBacking",
      operationId: "agent-service-provider",
      contractInstanceId: standingInstance.id,
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
        contractInstance: {id: standingInstance.id, generation: 1},
        backingReference: "agent-service-backing",
        capabilityGeneration: 1,
        state: "prepared",
        cleanup: "not-required",
      },
    });
    const standingBinding = publishAcknowledgedBinding(module.authority, {
      operationId: "agent-service-binding",
      contractInstanceId: standingInstance.id,
      consumer: standingConsumer,
      requirement: standingRequirement,
      name: "R2_STORAGE",
      verification: {type: "notRequired"},
      expectedBindingGeneration: 0,
      evaluatorPolicyHash: `sha256:${"9".repeat(64)}`,
    });
    if (standingBinding.type !== "bindingPublished") {
      throw new Error("agent service binding unavailable");
    }
    module.authority.execute({
      type: "recordAuthorityDebt",
      operationId: "agent-service-authority-debt",
      record: {
        bindingId: standingBinding.bindingId,
        upstreamAuthority: instanceRecord.upstreamAuthority,
        providerNativeScope: {
          provider: "cloudflare-r2",
          resources: ["deployment-r2-bucket"],
          operations: ["head", "get", "list", "put", "delete"],
          recipients: [],
          egress: [],
        },
        effectiveScope: {
          provider: "cloudflare-r2",
          resources: ["task-approved-prefix"],
          operations: ["get", "list", "put"],
          recipients: [],
          egress: [],
        },
        enforcementLayer: "contract",
        revocationGranularity: "binding-generation",
        risk: "low",
        exceptionOwner: "reviewer",
        productionEligibility: "eligible",
        remediation: "retain task envelope enforcement",
        lifecycle: "open",
      },
    });
    const consumerAuthority = createConsumerEnvironmentAuthority(
      durableStorage,
      () => { throw new Error("environment not used by task record test"); },
    );
    consumerAuthority.putWorkload({
      id: "workload-1",
      consumerId: standingConsumer.consumerId,
      consumerGeneration: 1,
      projectId: "project-1",
      environmentId: "environment-1",
      bindingSet: {id: "agent-service-bindings", version: 1},
      generation: 1,
      lifecycle: "active",
      agentService: {profileId: "agent-service-profile-1", role: "task-runner"},
    });
    consumerAuthority.putWorkloadRegistration({
      id: "registration-1",
      workloadId: "workload-1",
      adapterId: "cloudflare-service-binding.v1",
      issuer: "cloudflare-account:account-1",
      credentialSubject: "agent-service-subject",
      credentialGeneration: 1,
      generation: 1,
      lifecycle: "active",
    });
    expect(module.authority.execute({
      type: "recordAgentServiceProfile",
      record: {
        id: "agent-service-profile-1",
        workloadId: "workload-1",
        workloadGeneration: 1,
        workloadConsumer: standingConsumer,
        workloadRegistrationId: "registration-1",
        workloadRegistrationGeneration: 1,
        role: "task-runner",
        generation: 1,
        lifecycle: "active",
      },
    })).toMatchObject({type: "agentServiceProfileRecorded", generation: 1});
    expect(module.authority.execute({
      type: "recordWorkspacePrincipal",
      record: {
        id: "principal-1",
        kind: "member",
        generation: 1,
        lifecycle: "active",
      },
    })).toMatchObject({type: "workspacePrincipalRecorded", generation: 1});
    const taskRequestedAt = Date.now();
    const maximumTaskAuthority = {
      provider: "cloudflare-r2",
      resourceIdentity: "task-approved-prefix",
      upstreamAuthorityIdentity: "deployment-r2-bucket",
      artifactApprovalId: approval.id,
      artifactApprovalEpoch: 1,
      operations: ["get", "list", "put"],
      recipients: [],
      egress: [],
      releaseClasses: ["observation"],
      sharing: "per-task",
      enforcementProfile: "r2-task-v1",
      maximumExpiresAt: taskRequestedAt + 60_000,
    } as const;
    const template = module.authority.execute({
      type: "recordTaskTemplateVersion",
      record: {
        taskTemplateId,
        version: 1,
        requirements: [{
          requirementId: mappedRequirement.id,
          name: "R2_STORAGE",
          required: true,
          artifactApprovalId: approval.id,
          artifactApprovalEpoch: 1,
          standingBinding: {
            name: "R2_STORAGE",
            bindingId: standingBinding.bindingId,
            bindingGeneration: 1,
            contractInstanceId: standingInstance.id,
            contractInstanceGeneration: 1,
          },
          maximumEffectiveAuthorityEnvelopeHash: `sha256:${"c".repeat(64)}`,
          maximumAuthority: maximumTaskAuthority,
          evaluatorPolicyHash: `sha256:${"9".repeat(64)}`,
          sharedState: {type: "isolated"},
        }],
        maximumTaskDurationMs: 60_000,
        principalEligibility: {type: "named", principalIds: ["principal-1"]},
        runtimeEnforcementProfile: "r2-task-v1",
        ceilingDigest: `sha256:${"d".repeat(64)}`,
      },
    });
    if (template.type !== "taskTemplateVersionRecorded") {
      throw new Error("task template unavailable");
    }
    const templateApproval = module.authority.execute({
      type: "recordTaskTemplateApproval",
      record: {
        taskTemplateId,
        taskTemplateVersion: 1,
        approvalEpoch: 1,
        ceilingDigest: `sha256:${"d".repeat(64)}`,
        artifactApprovals: [{id: approval.id, epoch: 1}],
        decidedBy: "reviewer",
        permissionGeneration: 1,
        decidedAt: Date.now(),
        lifecycle: "active",
      },
    });
    if (templateApproval.type !== "taskTemplateApprovalRecorded") {
      throw new Error("task template approval unavailable");
    }
    const agentService = {
      workloadId: "workload-1",
      workloadGeneration: 1,
      workloadConsumer: standingConsumer,
      workloadRegistrationId: "registration-1",
      workloadRegistrationGeneration: 1,
    };
    const materialized = module.authority.execute({
      type: "materializeAgentTaskDispatch",
      input: {
        operationId: "materialize-task-1",
        intentDigest: `sha256:${"e".repeat(64)}`,
        taskTemplateApprovalId: templateApproval.id,
        agentServiceProfileId: "agent-service-profile-1",
        expectedAgentServiceProfileGeneration: 1,
        agentService,
        principal: {id: "principal-1", generation: 1},
        requestedAt: taskRequestedAt,
      },
    });
    if (materialized.type !== "agentTaskDispatched") {
      throw new Error("task dispatch not materialized");
    }
    expect(module.authority.execute({
      type: "materializeAgentTaskDispatch",
      input: {
        operationId: "materialize-task-1",
        intentDigest: `sha256:${"e".repeat(64)}`,
        taskTemplateApprovalId: templateApproval.id,
        agentServiceProfileId: "agent-service-profile-1",
        expectedAgentServiceProfileGeneration: 1,
        agentService,
        principal: {id: "principal-1", generation: 1},
        requestedAt: taskRequestedAt,
      },
    })).toEqual(materialized);
    expect(module.authority.query({type: "agentTask", id: materialized.taskId}))
      .toMatchObject({
        value: {
          lifecycle: "dispatching",
          generation: 1,
          leaseGeneration: 1,
          ratchetVersion: 1,
          agentServiceProfileId: "agent-service-profile-1",
        },
      });
    const taskEnvironment = module.authority.query({
      type: "taskEnvironment",
      taskId: materialized.taskId,
      generation: 1,
    });
    expect(taskEnvironment).toMatchObject({
      value: {
        state: "materializing",
        bindings: [{
          name: "R2_STORAGE",
          required: true,
          upstreamBinding: {bindingId: standingBinding.bindingId, bindingGeneration: 1},
        }],
      },
    });
    if (taskEnvironment.type !== "taskEnvironment" || !taskEnvironment.value) {
      throw new Error("task environment unavailable");
    }
    const taskPlacement = taskEnvironment.value.bindings[0]!;
    expect(module.authority.query({type: "binding", id: taskPlacement.bindingId}))
      .toMatchObject({value: {status: "preparing", consumer: {type: "agentTask"}}});
    expect(module.authority.query({type: "bindingResolution", id: taskPlacement.resolutionId}))
      .toMatchObject({
        value: {
          placementDecision: {type: "taskDispatch", decisionId: materialized.dispatchDecisionId},
          upstreamBinding: {bindingId: standingBinding.bindingId},
        },
      });
    const taskInstance = module.authority.query({
      type: "contractInstance",
      id: taskPlacement.contractInstanceId,
    });
    if (taskInstance.type !== "contractInstance" || !taskInstance.value) {
      throw new Error("task instance unavailable");
    }
    module.authority.execute({
      type: "recordProviderBacking",
      operationId: "task-provider-backing",
      contractInstanceId: taskPlacement.contractInstanceId,
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
        contractInstance: {id: taskPlacement.contractInstanceId, generation: 1},
        backingReference: "task-specific-backing",
        capabilityGeneration: 1,
        state: "prepared",
        cleanup: "not-required",
      },
    });
    const taskEndpointSnapshot = {
      endpointId: `contract-instance:${taskPlacement.contractInstanceId}`,
      instanceId: taskPlacement.contractInstanceId,
      instanceGeneration: 1,
      artifactHash: taskInstance.value.artifactHash,
      runtimeProfileHash: taskInstance.value.runtimeProfileHash,
      reachabilityId: `binding:${taskPlacement.bindingId}`,
      reachabilityGeneration: 1,
      authoritySnapshotDigest: `sha256:${"2".repeat(64)}`,
      compositionLineage: [`contract-instance:${taskPlacement.contractInstanceId}`],
      chainDepth: 0,
      maxChainDepth: 8,
    };
    expect(module.authority.execute({
      type: "publishMaterializedAgentTask",
      operationId: "publish-task-environment",
      taskId: materialized.taskId,
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      endpoints: [{
        bindingId: taskPlacement.bindingId,
        contractInstanceId: taskPlacement.contractInstanceId,
        snapshot: taskEndpointSnapshot,
        acknowledgement: {
          endpointId: taskEndpointSnapshot.endpointId,
          reachabilityGeneration: taskEndpointSnapshot.reachabilityGeneration,
          taskGeneration: 1,
          leaseGeneration: 1,
          environmentGeneration: 1,
          ratchetVersion: 1,
          cancellationId: taskEnvironment.value.cancellationId,
          cancellationGeneration: 1,
          networkGeneration: 1,
          bindingId: taskPlacement.bindingId,
          bindingGeneration: 1,
          contractInstanceId: taskPlacement.contractInstanceId,
          contractInstanceGeneration: 1,
        },
      }],
    })).toMatchObject({type: "materializedAgentTaskPublished", environmentGeneration: 1});
    const replacementBindingId = "task-binding-ratchet-2" as typeof taskPlacement.bindingId;
    const replacementResolutionId = "task-resolution-ratchet-2" as typeof taskPlacement.resolutionId;
    const replacementInstanceId =
      "task-instance-ratchet-2" as typeof taskPlacement.contractInstanceId;
    const replacementEndpointSnapshot = {
      ...taskEndpointSnapshot,
      endpointId: `contract-instance:${replacementInstanceId}`,
      instanceId: replacementInstanceId,
      reachabilityId: `binding:${replacementBindingId}`,
      authoritySnapshotDigest: `sha256:${"3".repeat(64)}`,
      compositionLineage: [`contract-instance:${replacementInstanceId}`],
    };
    const predecessorAuthority = {
      name: "R2_STORAGE",
      requirementId: taskPlacement.requirementId,
      bindingId: taskPlacement.bindingId,
      bindingGeneration: 1,
      contractInstanceId: taskPlacement.contractInstanceId,
      contractInstanceGeneration: 1,
      authority: maximumTaskAuthority,
    } as const;
    const replacementAuthority = {
      ...predecessorAuthority,
      bindingId: replacementBindingId,
      contractInstanceId: replacementInstanceId,
      authority: {...predecessorAuthority.authority,
        operations: ["get", "list"], maximumExpiresAt: taskRequestedAt + 30_000},
    } as const;
    const ratchetCommand = {
      type: "commitR2TaskRatchetReplacement",
      operationId: "ratchet-task-environment",
      taskId: materialized.taskId,
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 1,
      expectedRatchetVersion: 1,
      predecessorBindingId: taskPlacement.bindingId,
      replacementBindingId,
      replacementResolutionId,
      replacementContractInstanceId: replacementInstanceId,
      nextLeaseExpiresAt: taskRequestedAt + 30_000,
      predecessorAuthority,
      replacementAuthority,
      providerDescription: {
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
      providerResult: {
        provider: providerIdentity,
        contractInstance: {id: replacementInstanceId, generation: 1},
        backingReference: "task-specific-backing-narrower",
        capabilityGeneration: 1,
        state: "prepared",
        cleanup: "not-required",
      },
      endpointSnapshot: replacementEndpointSnapshot,
      endpointAcknowledgement: {
        endpointId: replacementEndpointSnapshot.endpointId,
        reachabilityGeneration: 1,
        taskGeneration: 1,
        leaseGeneration: 1,
        environmentGeneration: 2,
        ratchetVersion: 2,
        cancellationId: taskEnvironment.value.cancellationId,
        cancellationGeneration: 1,
        networkGeneration: 2,
      },
      predecessorInvalidation: {
        endpointId: taskEndpointSnapshot.endpointId,
        reachabilityGeneration: 1,
        invalidated: true,
        cancelledInvocations: 1,
        cleanupFailures: 0,
      },
    } as const;
    expect(() => module.authority.execute({...ratchetCommand,
      operationId: "ratchet-fabricated-parent",
      predecessorAuthority: {...predecessorAuthority,
        authority: {...predecessorAuthority.authority,
          operations: ["get", "list", "put", "delete"]}},
    })).toThrow("parent authority is not canonical");
    expect(module.authority.execute(ratchetCommand)).toMatchObject({
      type: "r2TaskRatchetCommitted",
      environmentGeneration: 2,
      ratchetVersion: 2,
      networkGeneration: 2,
    });
    expect(module.authority.execute(ratchetCommand)).toMatchObject({
      type: "r2TaskRatchetCommitted",
      environmentGeneration: 2,
    });
    expect(module.authority.query({type: "binding", id: taskPlacement.bindingId}))
      .toMatchObject({value: {status: "retracted", generation: 2}});
    expect(module.authority.query({type: "binding", id: replacementBindingId}))
      .toMatchObject({value: {predecessorId: taskPlacement.bindingId}});
    expect(module.authority.query({type: "authorityDebtByBinding", bindingId: replacementBindingId}))
      .toMatchObject({value: {bindingId: replacementBindingId, lifecycle: "open"}});
    expect(() => module.authority.execute({
      type: "materializeAgentTaskDispatch",
      input: {
        operationId: "materialize-task-unsupported-scope",
        intentDigest: `sha256:${"f".repeat(64)}`,
        taskTemplateApprovalId: templateApproval.id,
        agentServiceProfileId: "agent-service-profile-1",
        expectedAgentServiceProfileGeneration: 1,
        agentService,
        principal: {id: "principal-1", generation: 1},
        requestedAt: Date.now(),
        applicationScope: {
          kind: "workspaceApplication",
          scopeId: "unsupported-scope",
          scopeGeneration: 1,
        },
      },
    })).toThrow("no application-scope adapter");
    const authoritySession = module.authority.openSession("test-owner", true);
    if (!authoritySession) throw new Error("owner authority unavailable");
    const cancellationDigest = `sha256:${"1".repeat(64)}`;
    const cancellationOperation = module.authority.beginOperation(
      authoritySession,
      "cancel-agent-task-1",
      cancellationDigest,
    );
    const cancellationCommand = {
      type: <const>"cancelAgentTask",
      operationId: cancellationOperation.id,
      stepKey: "request-cancellation",
      requestDigest: cancellationDigest,
      expectedAuthorityEpoch: authoritySession.authorityEpoch,
      expectedPermissionGeneration: authoritySession.permissionGeneration,
      taskId: materialized.taskId,
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 2,
      expectedRatchetVersion: 2,
    };
    expect(module.authority.requestAgentTaskCancellation(
      authoritySession,
      cancellationCommand,
      cancellationDigest,
    )).toMatchObject({
      type: "agentTaskCancellationRequested",
      cancellationGeneration: 1,
      state: "requested",
    });
    expect(module.authority.requestAgentTaskCancellation(
      authoritySession,
      cancellationCommand,
      cancellationDigest,
    )).toMatchObject({cancellationGeneration: 1});
    expect(module.authority.execute({
      type: "recordAgentTaskOperationalState",
      record: {
        taskId: materialized.taskId,
        taskGeneration: 1,
        environmentGeneration: 2,
        ratchetVersion: 2,
        protectedResultRefs: ["protected-result:1"],
        missingAcknowledgementRefs: ["endpoint:1"],
        staleParallelWorkRefs: ["invocation:old"],
        sourceActivityRefs: ["source-activity:1"],
        agentActivityRefs: ["agent-activity:1"],
        revision: 1,
      },
    })).toMatchObject({type: "agentTaskOperationalStateRecorded", revision: 1});
    expect(module.authority.listAgentTaskAuthorityViews(authoritySession)).toEqual([
      expect.objectContaining({
        taskId: materialized.taskId,
        template: expect.objectContaining({version: 1, approvalLifecycle: "active"}),
        environment: expect.objectContaining({generation: 2, ratchetVersion: 2}),
        agentServiceWorkload: {id: "workload-1", generation: 1},
        cancellation: {generation: 1, state: "requested"},
        authorityDebtRefs: [expect.stringMatching(/^authority-debt:/)],
        blocks: expect.arrayContaining([
          {type: "protectedResult", reference: "protected-result:1"},
          {type: "missingAcknowledgement", reference: "endpoint:1"},
          {type: "staleParallelWork", reference: "invocation:old"},
        ]),
        evidence: expect.objectContaining({
          authorityEvents: expect.arrayContaining([expect.stringMatching(/^authority-event:/)]),
          sourceActivities: ["source-activity:1"],
          agentActivities: ["agent-activity:1"],
        }),
      }),
    ]);
    expect(module.authority.listTaskTemplateAuthorityViews(authoritySession)).toEqual([
      expect.objectContaining({
        id: taskTemplateId,
        version: 1,
        approvalLifecycle: "active",
        requirements: [expect.objectContaining({
          name: "R2_STORAGE",
          artifactApprovalId: approval.id,
          artifactApprovalEpoch: 1,
        })],
        newDispatchConsequence: expect.any(String),
        activeTaskConsequence: expect.any(String),
      }),
    ]);
    const terminal = module.authority.execute({
      type: "beginPublishedAgentTaskTermination",
      operationId: "cancel-published-task",
      taskId: materialized.taskId,
      expectedTaskGeneration: 1,
      expectedEnvironmentGeneration: 2,
      expectedRatchetVersion: 2,
      outcome: "cancelled",
    });
    if (terminal.type !== "publishedAgentTaskTerminationBegun") {
      throw new Error("published task termination unavailable");
    }
    expect(() => module.authority.execute({
      type: "commitDestroyedAgentTask",
      intentId: terminal.intentId,
    })).toThrow("not acknowledged");
    expect(module.authority.execute({
      type: "acknowledgePublishedAgentTaskDestruction",
      intentId: terminal.intentId,
      endpointAcknowledgements: [{
        endpointId: replacementEndpointSnapshot.endpointId,
        reachabilityGeneration: replacementEndpointSnapshot.reachabilityGeneration,
        invalidated: true,
        cancelledInvocations: 1,
        cleanupFailures: 0,
      }],
    })).toMatchObject({type: "publishedAgentTaskDestructionAcknowledged"});
    expect(module.authority.execute({
      type: "commitDestroyedAgentTask",
      intentId: terminal.intentId,
    })).toMatchObject({type: "publishedAgentTaskTerminated", generation: 2});
    expect(module.authority.execute({
      type: "commitDestroyedAgentTask",
      intentId: terminal.intentId,
    })).toMatchObject({type: "publishedAgentTaskTerminated", generation: 2});
    expect(module.authority.query({type: "agentTask", id: materialized.taskId}))
      .toMatchObject({value: {lifecycle: "cancelled", generation: 2}});
    expect(module.authority.listAgentTaskAuthorityViews(authoritySession))
      .toEqual([expect.objectContaining({cancellation: {generation: 1, state: "acknowledged"}})]);
    expect(module.authority.query({type: "binding", id: taskPlacement.bindingId}))
      .toMatchObject({value: {status: "retracted", generation: 2}});
    expect(module.authority.query({
      type: "taskEnvironment",
      taskId: materialized.taskId,
      generation: 1,
    })).toMatchObject({value: {state: "invalidated"}});
  });

  it("replays a ready-state unbind before cutover instead of preserving removed authority", () => {
    const {module} = makeModule({legacyPlacement: true});
    module.authority.execute({type: "initialize"});
    module.authority.execute({type: "beginBackfill", migrationId: "unbind-migration"});
    module.authority.execute({type: "backfillLegacyContract", legacyContractId: 10});
    const candidate = module.authority.query({type: "cutoverCandidate"});
    if (candidate.type !== "cutoverCandidate") throw new Error("candidate unavailable");
    module.authority.execute({type: "markReadyToCutover", expectedDigest: candidate.value.digest});
    module.compatibility.unbind({consumerId: 1, name: "FILES"});
    expect(module.authority.query({type: "status"})).toMatchObject({
      type: "status",
      value: {state: "backfilling", pendingMigrationDeltas: 1},
    });
    module.authority.execute({type: "backfillLegacyContract", legacyContractId: 10});
    const replayed = module.authority.query({type: "cutoverCandidate"});
    if (replayed.type !== "cutoverCandidate") throw new Error("candidate unavailable");
    expect(replayed.value.bindingCount).toBe(0);
    module.authority.execute({type: "markReadyToCutover", expectedDigest: replayed.value.digest});
    module.authority.execute({type: "cutover", expectedDigest: replayed.value.digest});
    expect(module.compatibility.queryVisibleBindings({consumerId: 1})).toEqual([]);
  });

  it("retracts the canonical Binding and Instance before a post-cutover legacy delete", () => {
    const {module} = makeModule({legacyPlacement: true});
    module.authority.execute({type: "initialize"});
    module.authority.execute({type: "beginBackfill", migrationId: "delete-migration"});
    const staged = module.authority.execute({
      type: "backfillLegacyContract",
      legacyContractId: 10,
    });
    if (staged.type !== "legacyContractBackfilled") throw new Error("Contract not staged");
    const candidate = module.authority.query({type: "cutoverCandidate"});
    if (candidate.type !== "cutoverCandidate") throw new Error("candidate unavailable");
    module.authority.execute({type: "markReadyToCutover", expectedDigest: candidate.value.digest});
    module.authority.execute({type: "cutover", expectedDigest: candidate.value.digest});

    module.compatibility.retractContract(10);

    expect(module.authority.query({type: "contractInstance", id: staged.instanceId}))
      .toMatchObject({type: "contractInstance", value: {lifecycle: "retracted", generation: 2}});
    expect(module.authority.query({
      type: "authorityTombstoneBySubject",
      subjectType: "contractInstance",
      subjectId: staged.instanceId,
    })).toMatchObject({
      type: "authorityTombstoneBySubject",
      value: {terminalReason: "legacy-contract-deleted", cleanup: "pending"},
    });
    expect(module.compatibility.queryVisibleBindings({consumerId: 1})).toEqual([]);
    expect(module.compatibility.queryBindingLineage({consumerId: 1})).toEqual([
      ["FILES", {target: 10}],
    ]);
  });

  it("shadow-backfills byte-stable identities and atomically cuts legacy bindings over to projections", () => {
    const {module, gadgets} = makeModule({legacyPlacement: true, legacyTombstone: true});
    module.authority.execute({type: "initialize"});
    module.authority.execute({type: "beginBackfill", migrationId: "migration-1"});
    const staged = module.authority.execute({type: "backfillLegacyContract", legacyContractId: 10});
    const retry = module.authority.execute({type: "backfillLegacyContract", legacyContractId: 10});
    const stagedTombstone = module.authority.execute({
      type: "backfillLegacyContract",
      legacyContractId: 11,
    });
    if (staged.type !== "legacyContractBackfilled" ||
        retry.type !== "legacyContractBackfilled") {
      throw new Error("legacy Contract not staged");
    }
    expect(retry).toEqual({...staged, changed: false});
    expect(module.authority.query({type: "contractInstance", id: staged.instanceId}))
      .toEqual({type: "contractInstance", value: undefined});

    const consumer = module.authority.execute({
      type: "mapLegacyConsumer",
      legacyWorkpieceId: 1,
    });
    if (consumer.type !== "legacyConsumerMapped") throw new Error("consumer not mapped");
    const candidate = module.authority.query({type: "cutoverCandidate"});
    if (candidate.type !== "cutoverCandidate") throw new Error("candidate unavailable");
    expect(candidate.value).toMatchObject({contractCount: 2, bindingCount: 1});
    module.authority.execute({
      type: "markReadyToCutover",
      expectedDigest: candidate.value.digest,
    });
    module.compatibility.renameBinding({
      consumerId: 1,
      oldName: "FILES",
      newName: "DOCUMENTS",
    });
    expect(module.authority.query({type: "status"})).toMatchObject({
      type: "status",
      value: {state: "backfilling", pendingMigrationDeltas: 1},
    });
    expect(() => module.authority.execute({
      type: "cutover",
      expectedDigest: candidate.value.digest,
    })).toThrow("Cannot cut over");
    const replay = module.authority.execute({
      type: "backfillLegacyContract",
      legacyContractId: 10,
    });
    expect(replay).toMatchObject({type: "legacyContractBackfilled", changed: true});
    const replayedCandidate = module.authority.query({type: "cutoverCandidate"});
    if (replayedCandidate.type !== "cutoverCandidate") {
      throw new Error("replayed candidate unavailable");
    }
    module.authority.execute({
      type: "markReadyToCutover",
      expectedDigest: replayedCandidate.value.digest,
    });
    module.authority.execute({
      type: "cutover",
      expectedDigest: replayedCandidate.value.digest,
    });
    expect(module.authority.query({type: "status"})).toMatchObject({
      type: "status",
      value: {
        state: "active",
        eventHighWatermark: 2,
        pendingMigrationDeltas: 0,
        cutoverDigest: replayedCandidate.value.digest,
      },
    });

    expect(module.authority.query({type: "contractInstance", id: staged.instanceId}))
      .toMatchObject({
        type: "contractInstance",
        value: {legacyWorkpieceId: 10, lifecycle: "ready"},
      });
    if (stagedTombstone.type !== "legacyContractBackfilled") {
      throw new Error("legacy tombstone not staged");
    }
    expect(module.authority.query({
      type: "authorityTombstoneBySubject",
      subjectType: "contractInstance",
      subjectId: stagedTombstone.instanceId,
    })).toMatchObject({
      type: "authorityTombstoneBySubject",
      value: {terminalReason: "legacy-contract-retracted", cleanup: "complete"},
    });
    expect(module.authority.query({
      type: "bindingByConsumerName",
      consumerId: consumer.id,
      name: "DOCUMENTS",
    })).toMatchObject({
      type: "bindingByConsumerName",
      value: {status: "active", generation: 1, contractInstanceId: staged.instanceId},
    });
    expect(module.compatibility.queryVisibleBindings({consumerId: 1})).toEqual([
      ["DOCUMENTS", {target: 10}],
    ]);

    gadgets.get(1)!.bindings.DOCUMENTS.target = 20;
    expect(module.compatibility.queryVisibleBindings({consumerId: 1})).toEqual([
      ["DOCUMENTS", {target: 10}],
    ]);
    expect(() => module.compatibility.bindContract({
      consumerId: 1,
      name: "RAW",
      contractId: 20,
    })).toThrow("disabled after canonical cutover");
  });
});
