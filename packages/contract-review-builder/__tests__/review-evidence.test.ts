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
        toolchain: {
          components: [
            {name: "@gadgets/contractors", identity: "sha256:" + "1".repeat(64)},
            {name: "esbuild", identity: "sha256:" + "2".repeat(64)},
            {name: "typescript", identity: "sha256:" + "3".repeat(64)},
          ],
        },
        recipe: {
          name: "contract-current",
          target: "es2022",
          platform: "neutral",
          moduleFormat: "esm",
          externals: ["cloudflare:workers"],
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
      policySnapshot: {name: "deployment-policy", deniedPackages: []},
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
