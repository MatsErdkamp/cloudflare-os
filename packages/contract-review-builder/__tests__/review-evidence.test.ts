import {describe, expect, it} from "vitest";

import {compileContract} from "@gadgets/contractors/compiler";
import type {ContractBuildInputs} from "@gadgets/contractors/artifact";

import {
  ReviewEvidenceError,
  buildContractReviewEvidence,
  canonicalReviewJson,
  parseContractReviewBundle,
  parseReviewComparison,
  type ReviewBuildRunner,
  type ReviewBuildRunnerFactory,
  type ReviewBuildRunResult,
} from "../src/index.js";

const CONTRACT_SOURCE = `
  import { defineContract } from "@gadgets/contractors/authoring";
  import { RpcTarget } from "cloudflare:workers";
  import type { Source } from "contract:source";
  export interface ContractBinding extends RpcTarget { read(id: string): Promise<string>; }
  class Binding extends RpcTarget implements ContractBinding {
    constructor(private readonly source: Source) { super(); }
    read(id: string) { return this.source.read(id); }
  }
  export default defineContract<Source, ContractBinding>((context) => new Binding(context.source));
`;

const BUILD_INPUTS: ContractBuildInputs = {
  modules: {"contract.ts": CONTRACT_SOURCE},
  mainModule: "contract.ts",
  sourceTypes: "interface SourceRoot { read(id: string): Promise<string>; }",
  sourceRootType: "SourceRoot",
  dependencies: {},
  compatibilityDate: "2026-08-09",
  compatibilityFlags: [],
};

function runnerResult(
  role: "candidate" | "verifier",
  environmentIdentity: string,
  mutate?: (result: ReviewBuildRunResult) => ReviewBuildRunResult,
): ReviewBuildRunner {
  return {
    async build(request) {
      const candidate = await compileContract(request.inputs);
      const result: ReviewBuildRunResult = {
        candidate,
        isolation: {
          role,
          producerIdentity: `trusted-${role}`,
          environmentIdentity,
          network: "disabled",
          mutableState: "fresh",
          networkAttempts: 0,
        },
        dependencyLock: {entries: []},
        directDependencyRequests: Object.entries(request.inputs.dependencies)
          .map(([name, version]) => ({name, version})),
        toolchain: {
          components: [
            {name: "@gadgets/contractors", identity: "sha256:" + "1".repeat(64)},
            {name: "esbuild", identity: "sha256:" + "2".repeat(64)},
            {name: "typescript", identity: "sha256:" + "3".repeat(64)},
          ],
        },
        recipe: {
          name: "contract-current",
          compatibilityDate: candidate.artifact.runtimeProfile.compatibilityDate,
          compatibilityFlags: candidate.artifact.runtimeProfile.compatibilityFlags,
          target: "es2022",
          platform: "neutral",
          moduleFormat: "esm",
          externals: ["cloudflare:workers"],
          publicRoot: "ContractBinding",
          authoringAbiHash: candidate.artifact.runtimeProfile.authoringAbi.declarationHash,
          runtimeHarnessHash: candidate.artifact.runtimeProfile.runtimeHarnessHash,
          runtimeModuleSetHash: candidate.artifact.runtimeProfile.runtimeModuleSetHash,
          runtimeProfileHash: candidate.artifact.runtimeProfileHash,
        },
      };
      return mutate ? mutate(result) : result;
    },
    [Symbol.dispose]() {},
  };
}

function factory(
  candidate = runnerResult("candidate", "candidate-environment"),
  verifier = runnerResult("verifier", "verifier-environment"),
): ReviewBuildRunnerFactory {
  return {
    create(request) {
      expect(request).toEqual({
        role: request.role,
        network: "disabled",
        mutableState: "fresh",
      });
      return request.role === "candidate" ? candidate : verifier;
    },
  };
}

describe("Contract review evidence", () => {
  it("builds reproducible unversioned evidence in two distinct isolated runners", async () => {
    const evidence = await buildContractReviewEvidence({
      inputs: BUILD_INPUTS,
      submittedProvenance: {
        submittedBy: {identity: "developer-1", generation: 4},
        authorship: "developer",
        origin: {kind: "import", digest: "sha256:" + "4".repeat(64)},
      },
      policySnapshot: {},
      baseline: {kind: "none"},
      comparisonGenerator: {name: "review-comparison", identity: "sha256:" + "5".repeat(64)},
    }, factory());

    expect(evidence.bundle.reproducibility).toBe("reproduced");
    expect(evidence.bundle.attestations.map(item => item.environmentIdentity)).toEqual([
      "candidate-environment",
      "verifier-environment",
    ]);
    expect(evidence.bundle).not.toHaveProperty("version");
    expect(evidence.bundle).not.toHaveProperty("createdAt");
    expect(evidence.comparison).not.toHaveProperty("version");
    expect(evidence.bundle.artifact.hash).toBe(evidence.candidate.artifact.hash);
    expect(evidence.bundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidence.comparisonHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(parseContractReviewBundle(evidence.bundleJson)).toEqual(evidence.bundle);
    expect(parseReviewComparison(evidence.comparisonJson))
      .toEqual(evidence.comparison);
    const originalModules = evidence.comparison.sections.find(section =>
      section.name === "originalModules")!;
    expect(originalModules.items).toEqual([
      expect.objectContaining({
        key: "contract.ts",
        kind: "text",
        change: "added",
        newHash: evidence.bundle.originalModules[0]!.blob.hash,
        patch: expect.stringContaining("+  export interface ContractBinding"),
      }),
    ]);
    expect(evidence.comparison.sections.find(section => section.name === "publicInterface")!
      .items[0]!.exportedSurface?.added).toContainEqual(
        expect.stringContaining("export interface ContractBinding"),
      );
  });

  it("compares a reproduced baseline with exact per-item hashes and text patches", async () => {
    const provenance = {
      submittedBy: {identity: "developer", generation: 1},
      authorship: "developer",
      origin: {kind: "import" as const, digest: "sha256:" + "c".repeat(64)},
    };
    const comparisonGenerator = {
      name: "comparison",
      identity: "sha256:" + "d".repeat(64),
    };
    const baselineEvidence = await buildContractReviewEvidence({
      inputs: BUILD_INPUTS,
      submittedProvenance: provenance,
      policySnapshot: {},
      baseline: {kind: "none"},
      comparisonGenerator,
    }, factory());
    const changedInputs = {
      ...BUILD_INPUTS,
      modules: {"contract.ts": CONTRACT_SOURCE.replace("read(id: string)", "read(key: string)")},
    };
    const changed = await buildContractReviewEvidence({
      inputs: changedInputs,
      submittedProvenance: provenance,
      policySnapshot: {},
      baseline: {
        kind: "bundle",
        bundleHash: baselineEvidence.bundleHash,
        artifactApprovalReference: "approval:1",
      },
      baselineBundle: baselineEvidence.bundle,
      baselineBlobs: baselineEvidence.blobs,
      comparisonGenerator,
    }, factory(
      runnerResult("candidate", "candidate-changed"),
      runnerResult("verifier", "verifier-changed"),
    ));
    const sourceChange = changed.comparison.sections.find(section =>
      section.name === "originalModules")!.items[0]!;
    expect(sourceChange).toMatchObject({change: "modified", kind: "text"});
    expect(sourceChange.oldHash).not.toBe(sourceChange.newHash);
    expect(sourceChange.patch).toContain("-  export interface ContractBinding extends RpcTarget { read(id: string)");
    expect(sourceChange.patch).toContain("+  export interface ContractBinding extends RpcTarget { read(key: string)");
    expect(changed.comparison.sections.find(section => section.name === "artifactAuthority")!
      .items.some(item => item.key === "hash" && item.change === "modified")).toBe(true);
  });

  it.each([
    ["network use", runnerResult("verifier", "verifier", result => ({
      ...result,
      isolation: {...result.isolation, networkAttempts: 1},
    }))],
    ["shared mutable state", runnerResult("verifier", "candidate-environment")],
    ["dependency drift", runnerResult("verifier", "verifier", result => ({
      ...result,
      dependencyLock: {entries: [{name: "drift", version: "1.0.0", integrity: "sha256-abc", packageContentHash: "sha256:" + "6".repeat(64)}]},
    }))],
    ["toolchain drift", runnerResult("verifier", "verifier", result => ({
      ...result,
      toolchain: {components: [...result.toolchain.components, {name: "runtime", identity: "sha256:" + "7".repeat(64)}]},
    }))],
    ["artifact mismatch", runnerResult("verifier", "verifier", result => ({
      ...result,
      candidate: {...result.candidate, artifact: {...result.candidate.artifact, publicTypes: "changed"}},
    }))],
  ])("fails closed on %s", async (_name, verifier) => {
    await expect(buildContractReviewEvidence({
      inputs: BUILD_INPUTS,
      submittedProvenance: {
        submittedBy: {identity: "developer", generation: 1},
        authorship: "developer",
        origin: {kind: "import", digest: "sha256:" + "8".repeat(64)},
      },
      policySnapshot: {},
      baseline: {kind: "none"},
      comparisonGenerator: {name: "comparison", identity: "sha256:" + "9".repeat(64)},
    }, factory(runnerResult("candidate", "candidate-environment"), verifier)))
      .rejects.toBeInstanceOf(ReviewEvidenceError);
  });

  it("fails closed when recorded deployment policy differs from compiler policy", async () => {
    await expect(buildContractReviewEvidence({
      inputs: BUILD_INPUTS,
      submittedProvenance: {
        submittedBy: {identity: "developer", generation: 1},
        authorship: "developer",
        origin: {kind: "import", digest: "sha256:" + "8".repeat(64)},
      },
      policySnapshot: {deniedPackages: ["zod"]},
      baseline: {kind: "none"},
      comparisonGenerator: {name: "comparison", identity: "sha256:" + "9".repeat(64)},
    }, factory())).rejects.toThrow("policy snapshot");
  });

  it("rejects non-canonical, unknown, oversized, and hash-mismatched manifests", async () => {
    const evidence = await buildContractReviewEvidence({
      inputs: BUILD_INPUTS,
      submittedProvenance: {
        submittedBy: {identity: "developer", generation: 1},
        authorship: "developer",
        origin: {kind: "import", digest: "sha256:" + "a".repeat(64)},
      },
      policySnapshot: {},
      baseline: {kind: "none"},
      comparisonGenerator: {name: "comparison", identity: "sha256:" + "b".repeat(64)},
    }, factory());

    expect(() => parseContractReviewBundle(` ${evidence.bundleJson}`))
      .toThrow("canonical");
    const withUnknown = {...evidence.bundle, approval: true};
    expect(() => parseContractReviewBundle(canonicalReviewJson(withUnknown))).toThrow("Invalid");
    expect(() => parseContractReviewBundle("x".repeat(256 * 1024 + 1))).toThrow("size limit");
    await expect(import("../src/parser.js").then(({verifyContractReviewManifest}) =>
      verifyContractReviewManifest(evidence.bundleJson, "sha256:" + "f".repeat(64))))
      .rejects.toThrow("hash");
  });

  it("keeps proposal, reviewer, installation, and creation metadata outside executable identity", async () => {
    const first = await compileContract(BUILD_INPUTS);
    const second = await compileContract(BUILD_INPUTS);
    expect(first.creation.createdAt).not.toBe("");
    expect(first.artifact.hash).toBe(second.artifact.hash);
    expect(canonicalReviewJson(first.artifact)).not.toContain("createdAt");
  });
});
