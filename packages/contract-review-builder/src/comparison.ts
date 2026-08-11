import {canonicalReviewJson, hashReviewValue, ReviewEvidenceError} from "./canonical.js";
import {COMPARISON_GENERATOR_IDENTITY} from "./generated/comparison-generator-identity.js";
import {REVIEW_LIMITS} from "./limits.js";
import type {
  ContractReviewBundle,
  ReviewBaseline,
  ReviewBlobReference,
  ReviewComparison,
  ReviewComparisonItem,
  ReviewComparisonSection,
} from "./types.js";

const SECTION_NAMES = [
  "originalModules",
  "emittedExecutable",
  "artifactAuthority",
  "publicInterface",
  "sourceDeclaration",
  "dependencies",
  "toolchainAndRecipe",
  "originAndAuthorship",
  "reproducibility",
] as const;
type SectionName = typeof SECTION_NAMES[number];
type Change = ReviewComparisonItem["change"];
type ItemKind = ReviewComparisonItem["kind"];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
// The manifest itself is capped at 256 KiB, so rendered patches use the smaller bound in practice.
const PATCH_MANIFEST_BUDGET = Math.min(REVIEW_LIMITS.renderedComparisonPatchBytes, 128 * 1024);
/** Returns the sole registered comparison implementation and its content-addressed identity. */
export async function registeredReviewComparisonGenerator(): Promise<Readonly<{
  readonly name: string;
  readonly identity: string;
}>> {
  return {
    name: "contract-review-comparison",
    identity: COMPARISON_GENERATOR_IDENTITY,
  };
}

function requireBlob(
  blobs: ReadonlyMap<string, Uint8Array>,
  reference: ReviewBlobReference,
): Uint8Array {
  const value = blobs.get(reference.hash);
  if (!value || value.byteLength !== reference.bytes) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", `Comparison blob ${reference.hash} is missing.`);
  }
  return value;
}

function textBlob(blobs: ReadonlyMap<string, Uint8Array>, reference: ReviewBlobReference): string {
  return decoder.decode(requireBlob(blobs, reference));
}

function jsonBlob(blobs: ReadonlyMap<string, Uint8Array>, reference: ReviewBlobReference): unknown {
  const text = textBlob(blobs, reference);
  const value = JSON.parse(text) as unknown;
  if (canonicalReviewJson(value) !== text) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Comparison JSON blob is not canonical.");
  }
  return value;
}

function change(oldHash: string | undefined, newHash: string | undefined): Change {
  if (oldHash === undefined) return "added";
  if (newHash === undefined) return "removed";
  return oldHash === newHash ? "unchanged" : "modified";
}

function exactPatch(oldText: string | undefined, newText: string | undefined): string {
  const oldLines = oldText === undefined ? [] : oldText.split("\n");
  const newLines = newText === undefined ? [] : newText.split("\n");
  return [
    "--- old",
    "+++ new",
    ...oldLines.map(line => `-${line}`),
    ...newLines.map(line => `+${line}`),
  ].join("\n");
}

function truncatePatch(patch: string, remainingBytes: number): {patch?: string; truncated?: true} {
  if (remainingBytes <= 0) return {truncated: true};
  if (encoder.encode(patch).byteLength <= remainingBytes) return {patch};
  let low = 0;
  let high = patch.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(patch.slice(0, middle)).byteLength <= remainingBytes) low = middle;
    else high = middle - 1;
  }
  return {patch: patch.slice(0, low), truncated: true};
}

async function textComparisonItem(
  key: string,
  oldReference: ReviewBlobReference | undefined,
  newReference: ReviewBlobReference | undefined,
  oldBlobs: ReadonlyMap<string, Uint8Array> | undefined,
  newBlobs: ReadonlyMap<string, Uint8Array>,
  oldSurfaceReference: ReviewBlobReference | undefined,
  newSurfaceReference: ReviewBlobReference | undefined,
  patchBudget: {remaining: number},
): Promise<ReviewComparisonItem> {
  const oldText = oldReference && oldBlobs ? textBlob(oldBlobs, oldReference) : undefined;
  const newText = newReference ? textBlob(newBlobs, newReference) : undefined;
  const fullPatch = exactPatch(oldText, newText);
  const rendered = truncatePatch(fullPatch, patchBudget.remaining);
  if (rendered.patch) patchBudget.remaining -= encoder.encode(rendered.patch).byteLength;
  const oldSurface = oldSurfaceReference && oldBlobs
    ? jsonBlob(oldBlobs, oldSurfaceReference) as readonly string[] : undefined;
  const newSurface = newSurfaceReference
    ? jsonBlob(newBlobs, newSurfaceReference) as readonly string[] : undefined;
  return {
    key,
    kind: "text",
    change: change(oldReference?.hash, newReference?.hash),
    ...(oldReference ? {oldHash: oldReference.hash} : {}),
    ...(newReference ? {newHash: newReference.hash} : {}),
    ...(rendered.patch === undefined ? {} : {patch: rendered.patch}),
    ...(rendered.truncated ? {patchTruncated: true as const} : {}),
    ...(newSurfaceReference ? {exportedSurface: {
      ...(oldSurfaceReference ? {oldHash: oldSurfaceReference.hash} : {}),
      newHash: newSurfaceReference.hash,
      added: newSurface?.filter(item => !oldSurface?.includes(item)) ?? [],
      removed: oldSurface?.filter(item => !newSurface?.includes(item)) ?? [],
    }} : {}),
  };
}

function flatten(value: unknown, prefix = ""): ReadonlyMap<string, unknown> {
  const result = new Map<string, unknown>();
  const visit = (item: unknown, path: string): void => {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const entries = Object.entries(item as Record<string, unknown>).toSorted(([left], [right]) =>
        left.localeCompare(right));
      if (entries.length > 0) {
        for (const [key, nested] of entries) visit(nested, path ? `${path}.${key}` : key);
        return;
      }
    }
    result.set(path || prefix || "value", item);
  };
  visit(value, prefix);
  return result;
}

async function valueItems(
  kind: ItemKind,
  oldValues: ReadonlyMap<string, unknown>,
  newValues: ReadonlyMap<string, unknown>,
): Promise<ReviewComparisonItem[]> {
  const keys = [...new Set([...oldValues.keys(), ...newValues.keys()])].toSorted();
  return Promise.all(keys.map(async key => {
    const oldValue = oldValues.get(key);
    const newValue = newValues.get(key);
    const oldHash = oldValues.has(key) ? await hashReviewValue(oldValue) : undefined;
    const newHash = newValues.has(key) ? await hashReviewValue(newValue) : undefined;
    return {
      key,
      kind,
      change: change(oldHash, newHash),
      ...(oldHash ? {oldHash} : {}),
      ...(newHash ? {newHash} : {}),
    };
  }));
}

function moduleMap(bundle: ContractReviewBundle | undefined, emitted: boolean) {
  const modules = emitted ? bundle?.artifact.emittedModules : bundle?.originalModules;
  return new Map(modules?.map(module => [module.path, module.blob]) ?? []);
}

function dependencyValues(
  bundle: ContractReviewBundle | undefined,
  blobs: ReadonlyMap<string, Uint8Array> | undefined,
): ReadonlyMap<string, unknown> {
  if (!bundle || !blobs) return new Map();
  const direct = jsonBlob(blobs, bundle.build.directDependencyRequests) as readonly Record<string, unknown>[];
  const lock = jsonBlob(blobs, bundle.build.dependencyLock) as {entries: readonly Record<string, unknown>[]};
  const trace = jsonBlob(blobs, bundle.build.trace) as {entries: readonly Record<string, unknown>[]};
  return new Map([
    ...direct.map(item => [`direct:${String(item.name)}`, item] as const),
    ...lock.entries.map(item => [`lock:${String(item.name)}@${String(item.version)}`, item] as const),
    ...trace.entries.map(item => [`trace:${String(item.kind)}:${String(item.path)}`, item] as const),
  ]);
}

function buildValues(
  bundle: ContractReviewBundle | undefined,
  blobs: ReadonlyMap<string, Uint8Array> | undefined,
): ReadonlyMap<string, unknown> {
  if (!bundle || !blobs) return new Map();
  return new Map([
    ...flatten(jsonBlob(blobs, bundle.build.toolchain), "toolchain"),
    ...flatten(jsonBlob(blobs, bundle.build.recipe), "recipe"),
    ...flatten(jsonBlob(blobs, bundle.build.policySnapshot), "governance"),
  ]);
}

function sectionValue(bundle: ContractReviewBundle, name: SectionName): unknown {
  switch (name) {
    case "originalModules": return bundle.originalModules;
    case "emittedExecutable": return bundle.artifact.emittedModules;
    case "artifactAuthority": return {hash: bundle.artifact.hash, blob: bundle.artifact.authority};
    case "publicInterface": return bundle.artifact.publicDeclaration;
    case "sourceDeclaration": return bundle.source;
    case "dependencies": return {
      direct: bundle.build.directDependencyRequests,
      lock: bundle.build.dependencyLock,
      trace: bundle.build.trace,
    };
    case "toolchainAndRecipe": return {
      toolchain: bundle.build.toolchain,
      recipe: bundle.build.recipe,
      policySnapshot: bundle.build.policySnapshot,
    };
    case "originAndAuthorship": return bundle.provenance;
    case "reproducibility": return bundle.attestations;
  }
}

async function sectionItems(
  name: SectionName,
  baselineBundle: ContractReviewBundle | undefined,
  baselineBlobs: ReadonlyMap<string, Uint8Array> | undefined,
  candidateBundle: ContractReviewBundle,
  candidateBlobs: ReadonlyMap<string, Uint8Array>,
  patchBudget: {remaining: number},
): Promise<ReviewComparisonItem[]> {
  if (name === "originalModules" || name === "emittedExecutable") {
    const oldModules = moduleMap(baselineBundle, name === "emittedExecutable");
    const newModules = moduleMap(candidateBundle, name === "emittedExecutable");
    const paths = [...new Set([...oldModules.keys(), ...newModules.keys()])].toSorted();
    return Promise.all(paths.map(path => textComparisonItem(
      path, oldModules.get(path), newModules.get(path), baselineBlobs, candidateBlobs,
      undefined, undefined, patchBudget,
    )));
  }
  if (name === "publicInterface" || name === "sourceDeclaration") {
    const oldReference = name === "publicInterface"
      ? baselineBundle?.artifact.publicDeclaration : baselineBundle?.source.declaration;
    const newReference = name === "publicInterface"
      ? candidateBundle.artifact.publicDeclaration : candidateBundle.source.declaration;
    const oldSurfaceReference = name === "publicInterface"
      ? baselineBundle?.artifact.publicExportedSurface : baselineBundle?.source.exportedSurface;
    const newSurfaceReference = name === "publicInterface"
      ? candidateBundle.artifact.publicExportedSurface : candidateBundle.source.exportedSurface;
    return [await textComparisonItem(
      name, oldReference, newReference, baselineBlobs, candidateBlobs,
      oldSurfaceReference, newSurfaceReference, patchBudget,
    )];
  }
  if (name === "artifactAuthority") {
    const oldValue = baselineBundle && baselineBlobs
      ? jsonBlob(baselineBlobs, baselineBundle.artifact.authority) : undefined;
    return valueItems(
      "field",
      oldValue === undefined ? new Map() : flatten(oldValue),
      flatten(jsonBlob(candidateBlobs, candidateBundle.artifact.authority)),
    );
  }
  if (name === "dependencies") {
    return valueItems(
      "dependency",
      dependencyValues(baselineBundle, baselineBlobs),
      dependencyValues(candidateBundle, candidateBlobs),
    );
  }
  if (name === "toolchainAndRecipe") {
    return valueItems(
      "toolchain",
      buildValues(baselineBundle, baselineBlobs),
      buildValues(candidateBundle, candidateBlobs),
    );
  }
  if (name === "originAndAuthorship") {
    return valueItems(
      "governance",
      baselineBundle ? flatten(baselineBundle.provenance) : new Map(),
      flatten(candidateBundle.provenance),
    );
  }
  return valueItems(
    "attestation",
    baselineBundle ? flatten(baselineBundle.attestations) : new Map(),
    flatten(candidateBundle.attestations),
  );
}

/** Generates a deterministic itemized comparison without making an approval claim. */
export async function createReviewComparison(
  baseline: ReviewBaseline,
  baselineBundle: ContractReviewBundle | undefined,
  baselineBlobs: ReadonlyMap<string, Uint8Array> | undefined,
  candidateBundle: ContractReviewBundle,
  candidateBlobs: ReadonlyMap<string, Uint8Array>,
  candidateBundleHash: string,
  registeredGenerator?: Readonly<{readonly name: string; readonly identity: string}>,
): Promise<ReviewComparison> {
  const generator = await registeredReviewComparisonGenerator();
  if (registeredGenerator && canonicalReviewJson(registeredGenerator) !== canonicalReviewJson(generator)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review Comparison generator is not registered.");
  }
  if (baseline.kind === "bundle") {
    if (!baselineBundle || !baselineBlobs || await hashReviewValue(baselineBundle) !== baseline.bundleHash) {
      throw new ReviewEvidenceError("INVALID_INPUT", "Comparison baseline evidence is missing or mismatched.");
    }
  } else if (baselineBundle !== undefined || baselineBlobs !== undefined) {
    throw new ReviewEvidenceError("INVALID_INPUT", "A full-addition comparison cannot include baseline evidence.");
  }
  const sections: ReviewComparisonSection[] = [];
  const patchBudget = {remaining: PATCH_MANIFEST_BUDGET};
  for (const name of SECTION_NAMES) {
    const newHash = await hashReviewValue(sectionValue(candidateBundle, name));
    const oldHash = baselineBundle
      ? await hashReviewValue(sectionValue(baselineBundle, name)) : undefined;
    sections.push({
      name,
      change: change(oldHash, newHash),
      ...(oldHash ? {oldHash} : {}),
      newHash,
      items: await sectionItems(
        name, baselineBundle, baselineBlobs, candidateBundle, candidateBlobs, patchBudget,
      ),
    });
  }
  return {
    baseline,
    candidateBundleHash,
    generator,
    sections,
  };
}
