import {describe, expect, it} from "vitest";

import {
  REVIEW_LIMITS,
  canonicalReviewJson,
  createReviewComparison,
  hashReviewValue,
  type BuiltContractReviewEvidence,
  type ContractReviewBundle,
  type ReviewBlobReference,
  type ReviewComparison,
} from "@gadgets/contract-review-builder";
import {
  R2ContractReviewEvidenceStore,
  type ContractReviewEvidenceBucket,
} from "../src/contract-review-evidence.js";

const SOURCE = `
  import {RpcTarget} from "cloudflare:workers";
  export interface ContractBinding extends RpcTarget { ping(): string; }
  class Binding extends RpcTarget implements ContractBinding { ping() { return "pong"; } }
  export default function createContract() { return new Binding(); }
`;
const SOURCE_TYPES = "interface SourceRoot { read(): Promise<string>; }";
const HASH = `sha256:${"1".repeat(64)}`;
const ARTIFACT = Object.freeze({
  mainModule: "contract.js" as const,
  modules: Object.freeze({"contract.js": "export default function createContract() {}"}),
  publicTypes: "export interface ContractBinding { ping(): string; }",
  publicRootType: "ContractBinding" as const,
  sourceTypeHash: "ddbaa6f909ccc6e333ce1db4f50cd86963f7680e6c05c31c0efb875bde772b4d",
  sourceRootType: "SourceRoot",
  dependencies: Object.freeze([]),
  runtimeProfile: Object.freeze({
    profile: "cloudflare-workers-dynamic" as const,
    compatibilityDate: "2026-08-09",
    compatibilityFlags: Object.freeze([]),
    globalOutbound: "none" as const,
    runtimeHarnessHash: "sha256:5ef0e8cf695217dc99a31f9f7d19493cadb8e6ef8d9be3009b6d8bc8944c06d0",
    runtimeModuleSetHash: "sha256:690fb2c9cfee1826d906df9ec019e33b156ec11fca41221040b94fb099ec590a",
    authoringAbi: Object.freeze({
      declarationHash: "sha256:4db57808ab1e8e389c2037a5257c020b5577c9b7ffbc28591ca19b75db809e28",
    }),
    lifecycle: Object.freeze({
      maxCompositionDepth: 8 as const,
      observerDrainTimeoutMs: 1_000 as const,
      rawReadableStreams: "unsupported" as const,
      rawWritableStreams: "unsupported" as const,
      rawTransformStreams: "unsupported" as const,
      rawAsyncIterators: "unsupported" as const,
      rawAbortSignals: "unsupported" as const,
      upstreamCancellation: "mediated" as const,
    }),
  }),
  runtimeProfileHash: "sha256:71f0d2d0754b9ffa5cbfa1594af3fec16bcb44ffe6a3955afcc96fc1ca6fb7e8",
  hash: "sha256:dfb991d0f9a8002bf260aa4fb75987fe6982b03dd3f743377ca3e7693f884290",
});

class MemoryBucket implements ContractReviewEvidenceBucket {
  readonly values = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
  race?: Readonly<{key: string; winner: Uint8Array}>;

  async get(key: string) {
    const value = this.values.get(key);
    return value === undefined ? null : {
      size: value.byteLength,
      arrayBuffer: async () => value.slice().buffer,
    };
  }

  async put(key: string, value: Uint8Array | string, options?: {onlyIf: {etagDoesNotMatch: string}}) {
    expect(options).toEqual({onlyIf: {etagDoesNotMatch: "*"}});
    this.writes.push(key);
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value.slice();
    if (this.race?.key === key) {
      this.values.set(key, this.race.winner.slice());
      this.race = undefined;
      return null;
    }
    if (this.values.has(key)) return null;
    this.values.set(key, bytes);
    return {key};
  }
}

async function blob(
  blobs: Map<string, Uint8Array>,
  value: string,
  mediaType: ReviewBlobReference["mediaType"],
): Promise<ReviewBlobReference> {
  const bytes = new TextEncoder().encode(value);
  const hash = await hashReviewValue(bytes);
  blobs.set(hash, bytes);
  return {hash, bytes: bytes.byteLength, mediaType};
}

async function evidence(): Promise<BuiltContractReviewEvidence> {
  const artifact = ARTIFACT;
  const candidate = {
    artifact: ARTIFACT,
    inputs: {
      modules: {"contract.ts": SOURCE},
      mainModule: "contract.ts",
      sourceTypes: SOURCE_TYPES,
      sourceRootType: "SourceRoot",
      dependencies: {},
      compatibilityDate: "2026-08-09",
      compatibilityFlags: Object.freeze([]),
    },
    trace: {entries: [], artifactHash: artifact.hash},
    creation: {createdAt: "2026-08-09T00:00:00.000Z"},
  } as const;
  const blobs = new Map<string, Uint8Array>();
  const artifactAuthority = await blob(blobs, canonicalReviewJson(artifact), "application/json");
  const emittedModule = await blob(
    blobs,
    artifact.modules["contract.js"]!,
    "text/javascript",
  );
  const publicDeclaration = await blob(blobs, artifact.publicTypes, "text/typescript");
  const publicExportedSurface = await blob(
    blobs,
    canonicalReviewJson([artifact.publicTypes]),
    "application/json",
  );
  const sourceDeclaration = await blob(blobs, SOURCE_TYPES, "text/typescript");
  const sourceExportedSurface = await blob(
    blobs,
    canonicalReviewJson([SOURCE_TYPES]),
    "application/json",
  );
  const dependencyLock = await blob(blobs, "{\"entries\":[]}", "application/json");
  const directDependencyRequests = await blob(blobs, "[]", "application/json");
  const toolchain = await blob(blobs, canonicalReviewJson({components: [
    {name: "@gadgets/contractors", identity: HASH},
    {name: "esbuild", identity: HASH},
    {name: "typescript", identity: HASH},
  ]}), "application/json");
  const recipe = await blob(blobs, canonicalReviewJson({
    name: "contract-current",
    compatibilityDate: artifact.runtimeProfile.compatibilityDate,
    compatibilityFlags: artifact.runtimeProfile.compatibilityFlags,
    target: "es2022",
    platform: "neutral",
    moduleFormat: "esm",
    externals: ["cloudflare:workers"],
    publicRoot: artifact.publicRootType,
    authoringAbiHash: artifact.runtimeProfile.authoringAbi.declarationHash,
    runtimeHarnessHash: artifact.runtimeProfile.runtimeHarnessHash,
    runtimeModuleSetHash: artifact.runtimeProfile.runtimeModuleSetHash,
    runtimeProfileHash: artifact.runtimeProfileHash,
  }), "application/json");
  const trace = await blob(blobs, canonicalReviewJson(candidate.trace), "application/json");
  const policySnapshot = await blob(blobs, "{}", "application/json");
  const bundle: ContractReviewBundle = {
    artifact: {
      hash: artifact.hash,
      authority: artifactAuthority,
      emittedModules: [{
        path: "contract.js",
        blob: emittedModule,
      }],
      publicDeclaration,
      publicExportedSurface,
    },
    originalModules: [{
      path: "contract.ts",
      blob: await blob(blobs, SOURCE, "text/typescript"),
    }],
    source: {
      declaration: sourceDeclaration,
      exportedSurface: sourceExportedSurface,
      rootType: "SourceRoot",
      typeHash: artifact.sourceTypeHash,
    },
    build: {
      mainModule: "contract.ts",
      inputSetHash: HASH,
      dependencyLock,
      directDependencyRequests,
      toolchain,
      recipe,
      trace,
      policySnapshot,
    },
    provenance: {
      submittedBy: {identity: "developer", generation: 1},
      authorship: "developer",
      origin: {kind: "import", digest: HASH},
    },
    attestations: [{
      role: "candidate",
      producerIdentity: "trusted-candidate",
      environmentIdentity: "candidate-environment",
      network: "disabled",
      mutableState: "fresh",
      networkAttempts: 0,
      inputSetHash: HASH,
      artifactHash: artifact.hash,
      publicDeclarationHash: publicDeclaration.hash,
      publicExportedSurfaceHash: publicExportedSurface.hash,
      sourceDeclarationHash: sourceDeclaration.hash,
      sourceExportedSurfaceHash: sourceExportedSurface.hash,
      dependencyLockHash: dependencyLock.hash,
      directDependencyRequestsHash: directDependencyRequests.hash,
      toolchainHash: toolchain.hash,
      recipeHash: recipe.hash,
      buildTraceHash: trace.hash,
    }, {
      role: "verifier",
      producerIdentity: "trusted-verifier",
      environmentIdentity: "verifier-environment",
      network: "disabled",
      mutableState: "fresh",
      networkAttempts: 0,
      inputSetHash: HASH,
      artifactHash: artifact.hash,
      publicDeclarationHash: publicDeclaration.hash,
      publicExportedSurfaceHash: publicExportedSurface.hash,
      sourceDeclarationHash: sourceDeclaration.hash,
      sourceExportedSurfaceHash: sourceExportedSurface.hash,
      dependencyLockHash: dependencyLock.hash,
      directDependencyRequestsHash: directDependencyRequests.hash,
      toolchainHash: toolchain.hash,
      recipeHash: recipe.hash,
      buildTraceHash: trace.hash,
    }],
    reproducibility: "reproduced",
    baseline: {kind: "none"},
  };
  const bundleJson = canonicalReviewJson(bundle);
  const bundleHash = await hashReviewValue(new TextEncoder().encode(bundleJson));
  const comparison: ReviewComparison = await createReviewComparison(
    {kind: "none"},
    undefined,
    undefined,
    bundle,
    blobs,
    bundleHash,
  );
  const comparisonJson = canonicalReviewJson(comparison);
  const comparisonHash = await hashReviewValue(new TextEncoder().encode(comparisonJson));
  return {
    candidate,
    bundle,
    bundleJson,
    bundleHash,
    comparison,
    comparisonJson,
    comparisonHash,
    blobs,
  };
}

describe("R2ContractReviewEvidenceStore", () => {
  it("publishes blobs before immutable Bundle and Comparison manifests and reads them fully", async () => {
    const bucket = new MemoryBucket();
    const store = new R2ContractReviewEvidenceStore(bucket);
    const value = await evidence();

    await store.put(value);
    expect(bucket.writes.slice(-2)).toEqual([
      `contracts/review/bundles/${value.bundleHash}.json`,
      `contracts/review/comparisons/${value.comparisonHash}.json`,
    ]);
    const firstWriteCount = bucket.writes.length;
    await store.put(value);

    expect(bucket.writes).toHaveLength(firstWriteCount);
    expect(bucket.values.has(`contracts/review/bundles/${value.bundleHash}.json`)).toBe(true);
    expect(bucket.values.has(`contracts/review/comparisons/${value.comparisonHash}.json`)).toBe(true);
    await expect(store.getBundle(value.bundleHash)).resolves.toEqual(value.bundle);
    await expect(store.getComparison(value.comparisonHash)).resolves.toEqual(value.comparison);
  });

  it("fails closed on an existing collision and a conflicting create-only race winner", async () => {
    const value = await evidence();
    const reference = value.bundle.originalModules[0]!.blob;
    const key = `contracts/review/blobs/${reference.hash}`;
    const bucket = new MemoryBucket();
    bucket.values.set(key, new Uint8Array([1]));
    await expect(new R2ContractReviewEvidenceStore(bucket).put(value)).rejects.toThrow("Conflicting");

    const raced = new MemoryBucket();
    raced.race = {key, winner: new Uint8Array([2])};
    await expect(new R2ContractReviewEvidenceStore(raced).put(value)).rejects.toThrow("race");
  });

  it("rejects missing, length-mismatched, and hash-mismatched referenced blobs on read", async () => {
    const value = await evidence();
    const bucket = new MemoryBucket();
    const store = new R2ContractReviewEvidenceStore(bucket);
    await store.put(value);
    const reference = value.bundle.originalModules[0]!.blob;
    const key = `contracts/review/blobs/${reference.hash}`;

    bucket.values.delete(key);
    await expect(store.getBundle(value.bundleHash)).rejects.toThrow("missing");
    bucket.values.set(key, new Uint8Array(reference.bytes));
    await expect(store.getBundle(value.bundleHash)).rejects.toThrow("hash mismatch");
  });

  it("rejects mismatched Comparison cross-references and malformed manifest schemas", async () => {
    const value = await evidence();
    const mismatched: ReviewComparison = {
      ...value.comparison,
      candidateBundleHash: `sha256:${"f".repeat(64)}`,
    };
    const comparisonJson = canonicalReviewJson(mismatched);
    const comparisonHash = await hashReviewValue(new TextEncoder().encode(comparisonJson));
    await expect(new R2ContractReviewEvidenceStore(new MemoryBucket()).put({
      ...value,
      comparison: mismatched,
      comparisonJson,
      comparisonHash,
    })).rejects.toThrow("different candidate");

    const fabricated: ReviewComparison = {
      ...value.comparison,
      sections: value.comparison.sections.map((section, index) =>
        index === 0 ? {...section, items: []} : section),
    };
    const fabricatedJson = canonicalReviewJson(fabricated);
    const fabricatedHash = await hashReviewValue(new TextEncoder().encode(fabricatedJson));
    await expect(new R2ContractReviewEvidenceStore(new MemoryBucket()).put({
      ...value,
      comparison: fabricated,
      comparisonJson: fabricatedJson,
      comparisonHash: fabricatedHash,
    })).rejects.toThrow("does not match its cited evidence");

    const bucket = new MemoryBucket();
    bucket.values.set(
      `contracts/review/bundles/${value.bundleHash}.json`,
      new TextEncoder().encode(JSON.stringify({...value.bundle, unknown: true})),
    );
    await expect(new R2ContractReviewEvidenceStore(bucket).getBundle(value.bundleHash))
      .rejects.toThrow();
  });

  it("enforces manifest, per-blob, and total evidence caps before publication", async () => {
    const value = await evidence();
    const oversizedBundle: ContractReviewBundle = {
      ...value.bundle,
      originalModules: [{
        ...value.bundle.originalModules[0]!,
        blob: {
          ...value.bundle.originalModules[0]!.blob,
          bytes: REVIEW_LIMITS.textBlobBytes + 1,
        },
      }],
    };
    const bundleJson = canonicalReviewJson(oversizedBundle);
    const bundleHash = await hashReviewValue(new TextEncoder().encode(bundleJson));
    const comparison = {...value.comparison, candidateBundleHash: bundleHash};
    const comparisonJson = canonicalReviewJson(comparison);
    const comparisonHash = await hashReviewValue(new TextEncoder().encode(comparisonJson));
    await expect(new R2ContractReviewEvidenceStore(new MemoryBucket()).put({
      ...value,
      bundle: oversizedBundle,
      bundleJson,
      bundleHash,
      comparison,
      comparisonJson,
      comparisonHash,
    })).rejects.toThrow("limit");

    await expect(new R2ContractReviewEvidenceStore(new MemoryBucket()).getBlob({
      hash: HASH,
      bytes: REVIEW_LIMITS.totalUniqueBlobBytes + 1,
      mediaType: "application/json",
    })).rejects.toThrow("limits");

    const bucket = new MemoryBucket();
    bucket.values.set(
      `contracts/review/bundles/${value.bundleHash}.json`,
      new Uint8Array(REVIEW_LIMITS.manifestBytes + 1),
    );
    await expect(new R2ContractReviewEvidenceStore(bucket).getBundle(value.bundleHash))
      .rejects.toThrow("byte limit");
  });
});
