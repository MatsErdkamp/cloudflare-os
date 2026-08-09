import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import ts from "typescript";

import * as v8Authoring from "../src/authoring/index.js";
import {
  canonicalContractJson,
  compileContractV2,
  hashArtifact,
  hashSourceTypes,
} from "../src/artifact/index.js";
import { createContractInvocationEvidence } from "../src/host/index.js";
import { CONTRACT_AUTHORING_ABI_V8 } from "../src/authoring/abi.js";

const V8_CONTRACT = `
  import {
    defineContract,
    type ContractApproval,
    type ContractCapabilityRestorer,
  } from "@gadgets/contractors/authoring";
  import { RpcTarget } from "cloudflare:workers";
  import type { Source } from "contract:source";

  export interface ContractBinding extends RpcTarget {
    remove(id: string): Promise<string>;
  }

  class Binding extends RpcTarget implements ContractBinding {
    constructor(
      private readonly source: Source,
      private readonly approval: ContractApproval<Source>,
    ) { super(); }
    remove(id: string) {
      return this.approval.manual(
        {title: "Remove", description: "Remove one item"},
        ({source}) => source.remove(id),
      );
    }
  }

  const restoreContractCapability: ContractCapabilityRestorer<Source> = (context) =>
    new Binding(context.source, context.approval);
  void restoreContractCapability;
  export default defineContract<Source, ContractBinding>((context) =>
    new Binding(context.source, context.approval));
`;

const SOURCE_TYPES = `interface ItemSource { remove(id: string): Promise<string>; }`;

function input(flags: readonly string[] = ["nodejs_compat", "strict_crypto_checks"]) {
  return {
    modules: { "contract.ts": V8_CONTRACT },
    mainModule: "contract.ts",
    sourceTypes: SOURCE_TYPES,
    sourceRootType: "ItemSource",
    dependencies: {},
    compatibilityDate: "2026-08-09",
    compatibilityFlags: flags,
  };
}

describe("Contractors v8 interface", () => {
  it("provides a narrow additive v8 authoring seam", () => {
    expect(Object.keys(v8Authoring).toSorted()).toEqual(["defineContract"]);
  });

  it("keeps every exported authoring declaration structurally equal to the hashed ABI", () => {
    const authoringDirectory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/authoring",
    );
    const conformancePath = path.join(authoringDirectory, "abi-conformance.ts");
    const ambientPath = path.join(authoringDirectory, "abi-conformance-ambient.d.ts");
    const ambientSpecifier = "@gadgets/contractors/authoring-ambient";
    const conformanceSource = `
      import {defineContract as actualDefine} from "./index.js";
      import type {
        ContractApproval as ActualApproval,
        ContractCapabilityRestorer as ActualRestorer,
        ContractContext as ActualContext,
        ContractFactory as ActualFactory,
        SharedContractState as ActualSharedState,
        ContractApprovalDescription as ActualDescription,
        ContractApprovalRequirement as ActualRequirement,
        ContractInvocationEvidence as ActualEvidence,
        ContractInvocationGenerations as ActualGenerations,
      } from "./index.js";
      import {defineContract as ambientDefine} from "${ambientSpecifier}";
      import type {
        ContractApproval as AmbientApproval,
        ContractCapabilityRestorer as AmbientRestorer,
        ContractContext as AmbientContext,
        ContractFactory as AmbientFactory,
        SharedContractState as AmbientSharedState,
        ContractApprovalDescription as AmbientDescription,
        ContractApprovalRequirement as AmbientRequirement,
        ContractInvocationEvidence as AmbientEvidence,
        ContractInvocationGenerations as AmbientGenerations,
      } from "${ambientSpecifier}";
      import type {RpcTarget} from "cloudflare:workers";
      interface Source { read(): Promise<string>; }
      interface Binding extends RpcTarget { read(): Promise<string>; }
      type Equal<Left, Right> =
        (<Value>() => Value extends Left ? 1 : 2) extends
        (<Value>() => Value extends Right ? 1 : 2)
          ? (<Value>() => Value extends Right ? 1 : 2) extends
            (<Value>() => Value extends Left ? 1 : 2) ? true : false
          : false;
      declare const checks: [
        Equal<ActualApproval<Source>, AmbientApproval<Source>>,
        Equal<ActualRestorer<Source>, AmbientRestorer<Source>>,
        Equal<ActualContext<Source>, AmbientContext<Source>>,
        Equal<ActualFactory<Source, Binding>, AmbientFactory<Source, Binding>>,
        Equal<ActualSharedState, AmbientSharedState>,
        Equal<ActualDescription, AmbientDescription>,
        Equal<ActualRequirement, AmbientRequirement>,
        Equal<ActualEvidence, AmbientEvidence>,
        Equal<ActualGenerations, AmbientGenerations>,
        Equal<typeof actualDefine, typeof ambientDefine>
      ];
      const exact: readonly true[] = checks;
      void exact;
    `;
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      lib: ["lib.es2023.d.ts"],
      types: ["@cloudflare/workers-types/experimental", "node"],
      noEmit: true,
    };
    const base = ts.createCompilerHost(options);
    const virtualFiles = new Map([
      [conformancePath, conformanceSource],
      [ambientPath, CONTRACT_AUTHORING_ABI_V8.replace(
        "@gadgets/contractors/authoring",
        ambientSpecifier,
      )],
    ]);
    const host: ts.CompilerHost = {
      ...base,
      fileExists: (fileName) => virtualFiles.has(fileName) || base.fileExists(fileName),
      readFile: (fileName) => virtualFiles.get(fileName) ?? base.readFile(fileName),
      getSourceFile: (fileName, languageVersion) => {
        const source = virtualFiles.get(fileName);
        return source === undefined
          ? base.getSourceFile(fileName, languageVersion)
          : ts.createSourceFile(fileName, source, languageVersion, true);
      },
    };
    const program = ts.createProgram({
      rootNames: [conformancePath, ambientPath],
      options,
      host,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(diagnostics).toEqual([]);

    const checker = program.getTypeChecker();
    const actualModule = program.getSourceFile(path.join(authoringDirectory, "index.ts"));
    const actualSymbol = actualModule && checker.getSymbolAtLocation(actualModule);
    const ambientSymbol = checker.getAmbientModules()
      .find((symbol) => symbol.name === `"${ambientSpecifier}"`);
    expect(actualSymbol).toBeDefined();
    expect(ambientSymbol).toBeDefined();
    const exportNames = (symbol: ts.Symbol | undefined) => symbol === undefined
      ? []
      : checker.getExportsOfModule(symbol).map((entry) => String(entry.escapedName)).toSorted();
    expect(exportNames(actualSymbol)).toEqual(exportNames(ambientSymbol));
  });

  it("returns an unapproved v2 build candidate with exact inputs and trace", async () => {
    const candidate = await compileContractV2(input());

    expect(candidate.artifact.formatVersion).toBe(2);
    expect(candidate.artifact).not.toHaveProperty("createdAt");
    expect(candidate).not.toHaveProperty("approval");
    expect(candidate).not.toHaveProperty("approved");
    expect(candidate.inputs.modules["contract.ts"]).toBe(V8_CONTRACT);
    expect(candidate.trace.artifactHash).toBe(candidate.artifact.hash);
    expect(candidate.trace.entries.map((entry) => entry.kind)).toEqual([
      "authoringAbi",
      "sourceTypes",
      "sourceModule",
      "publicTypes",
      "bundle",
      "runtimeHarness",
    ]);
    expect(candidate.artifact.runtimeProfile).toMatchObject({
      compatibilityFlags: ["nodejs_compat", "strict_crypto_checks"],
      globalOutbound: "none",
      runtimeHarnessVersion: "8",
      authoringAbi: { version: "8" },
    });
    await expect(hashSourceTypes(canonicalContractJson(candidate.artifact.runtimeProfile)))
      .resolves.toBe(candidate.artifact.runtimeProfileHash.slice("sha256:".length));
  });

  it("hashes exact flags and ABI/runtime bytes while excluding creation metadata", async () => {
    const first = await compileContractV2(input(["strict_crypto_checks", "nodejs_compat"]));
    const reordered = await compileContractV2(input(["nodejs_compat", "strict_crypto_checks"]));
    const changed = await compileContractV2(input(["nodejs_compat"]));

    expect(reordered.artifact.hash).toBe(first.artifact.hash);
    expect(reordered.artifact.runtimeProfileHash).toBe(first.artifact.runtimeProfileHash);
    expect(changed.artifact.hash).not.toBe(first.artifact.hash);
    expect(changed.artifact.runtimeProfileHash).not.toBe(first.artifact.runtimeProfileHash);
    expect(reordered.inputs).toEqual(first.inputs);
    expect(reordered.trace).toEqual(first.trace);
    expect({ ...first.creation, createdAt: "different" }).not.toEqual(first.creation);
    const { hash: _hash, ...identity } = first.artifact;
    await expect(hashArtifact({
      ...identity,
      runtimeProfile: {
        ...identity.runtimeProfile,
        runtimeHarnessHash: "sha256:changed",
      },
    })).resolves.not.toBe(first.artifact.hash);
    await expect(hashArtifact({
      ...identity,
      runtimeProfile: {
        ...identity.runtimeProfile,
        authoringAbi: {
          ...identity.runtimeProfile.authoringAbi,
          declarationHash: "sha256:changed",
        },
      },
    })).resolves.not.toBe(first.artifact.hash);
  });

  it("deep-copies and freezes every nested candidate record", async () => {
    const allowedPackages: string[] = [];
    const candidate = await compileContractV2({
      ...input(),
      organizationPolicy: { allowedPackages },
    });
    allowedPackages.push("zod");

    expect(candidate.inputs.organizationPolicy?.allowedPackages).toEqual([]);
    expect(Object.isFrozen(candidate.artifact.modules)).toBe(true);
    expect(Object.isFrozen(candidate.artifact.dependencies)).toBe(true);
    expect(Object.isFrozen(candidate.artifact.runtimeProfile.authoringAbi)).toBe(true);
    expect(Object.isFrozen(candidate.inputs.organizationPolicy?.allowedPackages)).toBe(true);
    expect(Object.isFrozen(candidate.trace.entries[0])).toBe(true);
    expect(Reflect.set(candidate.artifact.modules, "contract.js", "changed")).toBe(false);
    expect(() => (candidate.trace.entries as unknown[]).push({})).toThrow();
  });

  it("rejects duplicate, noncanonical, and legacy authoring inputs", async () => {
    await expect(compileContractV2(input(["nodejs_compat", "nodejs_compat"])))
      .rejects.toThrow("must be unique");
    await expect(compileContractV2(input(["NodeJS_Compat"])))
      .rejects.toThrow("lower-case");
    await expect(compileContractV2({
      ...input(),
      modules: {
        "contract.ts": V8_CONTRACT.replace(
          "@gadgets/contractors/authoring",
          "@gadgets/contractors",
        ),
      },
    })).rejects.toMatchObject({ code: "TYPE_CHECK_FAILED" });
  });

  it("mints closed immutable generation-aware invocation evidence at the host seam", () => {
    const generations = {
      consumer: 2,
      binding: 3,
      contractInstance: 4,
      environment: 5,
      authority: 6,
    };
    const invocationInput = {
      invocationId: "invocation-1",
      consumerId: "consumer-1",
      bindingId: "binding-1",
      contractInstanceId: "instance-1",
      artifactHash: "sha256:artifact",
      runtimeProfileHash: "sha256:profile",
      methodName: "remove",
      startedAt: 1,
      authoritySnapshotDigest: "sha256:snapshot",
      generations,
    };
    const evidence = createContractInvocationEvidence(invocationInput);

    generations.binding = 99;
    expect(evidence).toEqual({
      schemaVersion: 1,
      invocationId: "invocation-1",
      consumerId: "consumer-1",
      bindingId: "binding-1",
      contractInstanceId: "instance-1",
      artifactHash: "sha256:artifact",
      runtimeProfileHash: "sha256:profile",
      methodName: "remove",
      startedAt: 1,
      authoritySnapshotDigest: "sha256:snapshot",
      generations: {
        consumer: 2,
        binding: 3,
        contractInstance: 4,
        environment: 5,
        authority: 6,
      },
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.generations)).toBe(true);
    expect(() => createContractInvocationEvidence({
      ...invocationInput,
      generations: { ...evidence.generations, binding: -1 },
    })).toThrow("binding generation");
    expect(() => createContractInvocationEvidence({
      ...invocationInput,
      arbitraryCaller: { role: "manager" },
    } as never)).toThrow("Unknown invocation evidence field");
    expect(() => createContractInvocationEvidence({
      ...invocationInput,
      generations: { ...invocationInput.generations, task: 7 },
    } as never)).toThrow("closed generation fields");
    expect(() => createContractInvocationEvidence({
      ...invocationInput,
      generations: { binding: 3 },
    } as never)).toThrow("closed generation fields");
  });
});
