import {describe, expect, it} from "vitest";

import type {ContractBuildInputs} from "@gadgets/contractors/artifact";

import {
  buildContractReviewEvidence,
} from "../src/index.js";
import {createNodeReviewBuildRunnerFactory} from "../src/node-runner.js";

const INPUTS: ContractBuildInputs = {
  modules: {"contract.ts": `
    import {defineContract} from "@gadgets/contractors/authoring";
    import {RpcTarget} from "cloudflare:workers";
    import type {Source} from "contract:source";
    export interface ContractBinding extends RpcTarget { ping(): Promise<string>; }
    class Binding extends RpcTarget implements ContractBinding {
      constructor(private readonly source: Source) { super(); }
      ping() { return this.source.ping(); }
    }
    export default defineContract<Source, ContractBinding>(context => new Binding(context.source));
  `},
  mainModule: "contract.ts",
  sourceTypes: "interface PingSource { ping(): Promise<string>; }",
  sourceRootType: "PingSource",
  dependencies: {},
  compatibilityDate: "2026-08-09",
  compatibilityFlags: [],
};

function buildInput() {
  return {
    inputs: INPUTS,
    submittedProvenance: {
      submittedBy: {identity: "integration-test", generation: 1},
      authorship: "integration-test",
      origin: {kind: "import" as const, digest: "sha256:" + "1".repeat(64)},
    },
    policySnapshot: {},
    baseline: {kind: "none" as const},
    comparisonGenerator: {name: "comparison", identity: "sha256:" + "2".repeat(64)},
  };
}

describe("Node review runner", () => {
  it("uses two fresh network-disabled subprocesses", async () => {
    const evidence = await buildContractReviewEvidence(
      buildInput(),
      createNodeReviewBuildRunnerFactory({producerIdentity: "local-trusted-runner"}),
    );
    const environments = evidence.bundle.attestations.map(item => item.environmentIdentity);
    expect(environments[0].split(":")[0]).not.toBe(environments[1].split(":")[0]);
    expect(evidence.bundle.attestations.every(item =>
      item.network === "disabled" && item.mutableState === "fresh")).toBe(true);
  }, 120_000);

  it.each(["network", "undeclaredRead"] as const)("blocks the %s conformance probe", async probe => {
    const runner = createNodeReviewBuildRunnerFactory({
      producerIdentity: "local-trusted-runner",
      conformanceProbe: probe,
    }).create({role: "candidate", network: "disabled", mutableState: "fresh"});
    try {
      await expect(runner.build({inputs: INPUTS})).rejects.toThrow("failed closed");
    } finally {
      runner[Symbol.dispose]();
    }
  }, 30_000);

  it("locks installed package trees and traces exact consumed dependency files", async () => {
    const dependencyInputs: ContractBuildInputs = {
      ...INPUTS,
      modules: {"contract.ts": INPUTS.modules["contract.ts"]!
        .replace('import {RpcTarget}', 'import {z} from "zod";\n    import {RpcTarget}')
        .replace("ping() { return this.source.ping(); }", "ping() { z.string().parse(\"ping\"); return this.source.ping(); }")},
      dependencies: {zod: "4.2.0"},
    };
    const runner = createNodeReviewBuildRunnerFactory({producerIdentity: "local-trusted-runner"})
      .create({role: "candidate", network: "disabled", mutableState: "fresh"});
    try {
      const result = await runner.build({inputs: dependencyInputs});
      expect(result.dependencyLock.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: "zod",
          version: "4.2.0",
          packageContentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        }),
      ]));
      expect(result.candidate.trace.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "dependency",
          path: expect.stringMatching(/^zod@4\.2\.0\//),
          hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        }),
      ]));
    } finally {
      runner[Symbol.dispose]();
    }
  }, 120_000);
});
