import {parseContractArtifact, hashArtifact} from "@gadgets/contractors/artifact";

import {
  canonicalReviewJson,
  freezeReviewValue,
  hashReviewValue,
  isReviewHash,
  ReviewEvidenceError,
  reviewUtf8Bytes,
} from "./canonical.js";
import {REVIEW_LIMITS} from "./limits.js";
import type {
  ContractReviewBundle,
  ReviewBaseline,
  ReviewBlobReference,
  ReviewBuildAttestation,
  ReviewComparison,
  ReviewComparisonSection,
  ReviewSubmittedProvenance,
} from "./types.js";

const SOURCE_HASH = /^[0-9a-f]{64}$/;
const MEDIA_TYPES = new Set([
  "application/json",
  "text/plain",
  "text/typescript",
  "text/javascript",
]);
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

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid review evidence object.");
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value);
  const actual = Object.keys(result).toSorted();
  const expected = [...keys].toSorted();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid review evidence fields.");
  }
  return result;
}

function boundedString(
  value: unknown,
  label: string,
  max: number = REVIEW_LIMITS.metadataBytes,
): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.normalize("NFC") ||
      reviewUtf8Bytes(value) > max) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", `Invalid ${label}.`);
  }
  return value;
}

function safeGeneration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid provenance generation.");
  }
  return value as number;
}

function blobReference(value: unknown): ReviewBlobReference {
  const item = exact(value, ["bytes", "hash", "mediaType"]);
  if (!isReviewHash(item.hash) || !Number.isSafeInteger(item.bytes) || (item.bytes as number) < 0 ||
      typeof item.mediaType !== "string" || !MEDIA_TYPES.has(item.mediaType)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid review blob reference.");
  }
  return item as unknown as ReviewBlobReference;
}

function moduleEntries(value: unknown, kind: "authoring" | "emitted") {
  if (!Array.isArray(value) || value.length > REVIEW_LIMITS.moduleCount) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Review module count exceeds the protocol limit.");
  }
  let bytes = 0;
  let previous = "";
  const entries = value.map((entry) => {
    const item = exact(entry, ["blob", "path"]);
    const path = boundedString(item.path, "module path", REVIEW_LIMITS.pathBytes);
    if (path.startsWith("/") || path.includes("\\") || path.split("/").some(part =>
      part === "" || part === "." || part === "..") || /\p{Cc}/u.test(path) ||
      path <= previous) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid or unsorted review module path.");
    }
    previous = path;
    const blob = blobReference(item.blob);
    if (blob.bytes > REVIEW_LIMITS.textBlobBytes) {
      throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Review text blob exceeds the protocol limit.");
    }
    bytes += blob.bytes;
    return {path, blob};
  });
  const limit = kind === "authoring" ? REVIEW_LIMITS.totalAuthoringBytes : REVIEW_LIMITS.emittedBytes;
  if (bytes > limit) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", `${kind} modules exceed the protocol limit.`);
  }
  return entries;
}

function baseline(value: unknown): ReviewBaseline {
  const item = record(value);
  if (item.kind === "none") {
    exact(item, ["kind"]);
    return {kind: "none"};
  }
  const bundle = exact(item, ["artifactApprovalReference", "bundleHash", "kind"]);
  if (bundle.kind !== "bundle" || !isReviewHash(bundle.bundleHash)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid review baseline.");
  }
  return {
    kind: "bundle",
    bundleHash: bundle.bundleHash,
    artifactApprovalReference: boundedString(
      bundle.artifactApprovalReference,
      "artifact approval reference",
    ),
  };
}

function provenance(value: unknown): ReviewSubmittedProvenance {
  const item = exact(value, ["authorship", "origin", "submittedBy"]);
  const submitted = exact(item.submittedBy, ["generation", "identity"]);
  const submittedBy = {
    identity: boundedString(submitted.identity, "submitter identity"),
    generation: safeGeneration(submitted.generation),
  };
  const authorship = boundedString(item.authorship, "authorship");
  const origin = record(item.origin);
  if (origin.kind === "workspaceChat" || origin.kind === "gadget") {
    exact(origin, ["kind", "reference"]);
    return {submittedBy, authorship, origin: {
      kind: origin.kind,
      reference: boundedString(origin.reference, "origin reference"),
    }};
  }
  if (origin.kind === "import") {
    exact(origin, ["digest", "kind"]);
    if (!isReviewHash(origin.digest)) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid import digest.");
    }
    return {submittedBy, authorship, origin: {kind: "import", digest: origin.digest}};
  }
  const repository = exact(origin, ["commit", "kind", "path", "repository"]);
  if (repository.kind !== "repositoryClaim") {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid review origin.");
  }
  return {submittedBy, authorship, origin: {
    kind: "repositoryClaim",
    repository: boundedString(repository.repository, "repository claim"),
    commit: boundedString(repository.commit, "repository commit"),
    path: boundedString(repository.path, "repository path", REVIEW_LIMITS.pathBytes),
  }};
}

function attestation(value: unknown): ReviewBuildAttestation {
  const item = exact(value, [
    "artifactHash", "buildTraceHash", "dependencyLockHash", "environmentIdentity",
    "directDependencyRequestsHash", "inputSetHash", "mutableState", "network", "networkAttempts", "producerIdentity",
    "publicDeclarationHash", "publicExportedSurfaceHash", "recipeHash", "role",
    "sourceDeclarationHash", "sourceExportedSurfaceHash", "toolchainHash",
  ]);
  for (const key of [
    "artifactHash", "buildTraceHash", "dependencyLockHash", "directDependencyRequestsHash", "inputSetHash",
    "publicDeclarationHash", "publicExportedSurfaceHash", "recipeHash", "sourceDeclarationHash",
    "sourceExportedSurfaceHash", "toolchainHash",
  ]) {
    if (!isReviewHash(item[key])) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid build attestation hash.");
    }
  }
  if ((item.role !== "candidate" && item.role !== "verifier") || item.network !== "disabled" ||
      item.mutableState !== "fresh" || item.networkAttempts !== 0) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid build isolation attestation.");
  }
  boundedString(item.producerIdentity, "producer identity");
  boundedString(item.environmentIdentity, "environment identity");
  return item as unknown as ReviewBuildAttestation;
}

function parseCanonicalJson(json: string, limit: number): unknown {
  if (reviewUtf8Bytes(json) > limit) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Review manifest exceeds its size limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review manifest is not valid JSON.");
  }
  if (canonicalReviewJson(value) !== json) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review manifest is not canonical JSON.");
  }
  return value;
}

function collectBlobReferences(bundle: ContractReviewBundle): ReviewBlobReference[] {
  return [
    bundle.artifact.authority,
    ...bundle.artifact.emittedModules.map(item => item.blob),
    bundle.artifact.publicDeclaration,
    bundle.artifact.publicExportedSurface,
    ...bundle.originalModules.map(item => item.blob),
    bundle.source.declaration,
    bundle.source.exportedSurface,
    bundle.build.dependencyLock,
    bundle.build.directDependencyRequests,
    bundle.build.toolchain,
    bundle.build.recipe,
    bundle.build.trace,
    bundle.build.policySnapshot,
  ];
}

/** Parses one closed canonical Review Bundle and optionally verifies its manifest identity. */
export function parseContractReviewBundle(
  json: string,
): ContractReviewBundle {
  const root = exact(parseCanonicalJson(json, REVIEW_LIMITS.manifestBytes), [
    "artifact", "attestations", "baseline", "build", "originalModules", "provenance",
    "reproducibility", "source",
  ]);
  const artifact = exact(root.artifact, [
    "authority", "emittedModules", "hash", "publicDeclaration", "publicExportedSurface",
  ]);
  if (!isReviewHash(artifact.hash)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid reviewed Artifact hash.");
  }
  const source = exact(root.source, ["declaration", "exportedSurface", "rootType", "typeHash"]);
  if (typeof source.typeHash !== "string" || !SOURCE_HASH.test(source.typeHash)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid Source type hash.");
  }
  const build = exact(root.build, [
    "dependencyLock", "directDependencyRequests", "inputSetHash", "mainModule", "policySnapshot", "recipe", "toolchain", "trace",
  ]);
  if (!isReviewHash(build.inputSetHash)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid build input-set hash.");
  }
  const attestations = root.attestations;
  if (!Array.isArray(attestations) || attestations.length !== 2) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review Bundle requires two attestations.");
  }
  const result: ContractReviewBundle = {
    artifact: {
      hash: artifact.hash,
      authority: blobReference(artifact.authority),
      emittedModules: moduleEntries(artifact.emittedModules, "emitted"),
      publicDeclaration: blobReference(artifact.publicDeclaration),
      publicExportedSurface: blobReference(artifact.publicExportedSurface),
    },
    originalModules: moduleEntries(root.originalModules, "authoring"),
    source: {
      declaration: blobReference(source.declaration),
      exportedSurface: blobReference(source.exportedSurface),
      rootType: boundedString(source.rootType, "Source root type"),
      typeHash: source.typeHash,
    },
    build: {
      mainModule: boundedString(build.mainModule, "main module", REVIEW_LIMITS.pathBytes),
      inputSetHash: build.inputSetHash,
      dependencyLock: blobReference(build.dependencyLock),
      directDependencyRequests: blobReference(build.directDependencyRequests),
      toolchain: blobReference(build.toolchain),
      recipe: blobReference(build.recipe),
      trace: blobReference(build.trace),
      policySnapshot: blobReference(build.policySnapshot),
    },
    provenance: provenance(root.provenance),
    attestations: [attestation(attestations[0]), attestation(attestations[1])],
    reproducibility: root.reproducibility === "reproduced" ? "reproduced" : (() => {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review Bundle is not reproducible.");
    })(),
    baseline: baseline(root.baseline),
  };
  if (result.attestations[0].role !== "candidate" || result.attestations[1].role !== "verifier" ||
      result.attestations[0].environmentIdentity === result.attestations[1].environmentIdentity) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review runners are not distinct.");
  }
  const references = new Map<string, number>();
  for (const reference of collectBlobReferences(result)) {
    const existing = references.get(reference.hash);
    if (existing !== undefined && existing !== reference.bytes) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Conflicting review blob lengths.");
    }
    references.set(reference.hash, reference.bytes);
  }
  if ([...references.values()].reduce((sum, bytes) => sum + bytes, 0) >
      REVIEW_LIMITS.totalUniqueBlobBytes) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Review blobs exceed the total size limit.");
  }
  return freezeReviewValue(result);
}

/** Cryptographically verifies a canonical Review Bundle manifest identity. */
export async function verifyContractReviewManifest(json: string, expectedHash: string): Promise<void> {
  parseContractReviewBundle(json);
  if (!isReviewHash(expectedHash) || await hashReviewValue(new TextEncoder().encode(json)) !== expectedHash) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review Bundle hash mismatch.");
  }
}

/** Verifies every referenced blob and the embedded Contract Artifact identity. */
export async function verifyContractReviewBlobs(
  bundle: ContractReviewBundle,
  blobs: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  for (const reference of collectBlobReferences(bundle)) {
    const bytes = blobs.get(reference.hash);
    if (!bytes || bytes.byteLength !== reference.bytes || await hashReviewValue(bytes) !== reference.hash) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", `Review blob ${reference.hash} is missing or corrupt.`);
    }
  }
  const artifactBytes = blobs.get(bundle.artifact.authority.hash);
  if (!artifactBytes) throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Artifact evidence is missing.");
  const decoder = new TextDecoder();
  const artifactJson = decoder.decode(artifactBytes);
  const artifactValue = JSON.parse(artifactJson) as unknown;
  if (canonicalReviewJson(artifactValue) !== artifactJson) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Artifact evidence is not canonical.");
  }
  const artifact = parseContractArtifact(artifactValue);
  const {hash, ...authority} = artifact;
  if (hash !== bundle.artifact.hash || await hashArtifact(authority) !== hash) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Reviewed Artifact identity is invalid.");
  }
  const emitted = new Map(bundle.artifact.emittedModules.map(item => [item.path, item.blob.hash]));
  if (Object.keys(artifact.modules).length !== emitted.size) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Emitted module evidence is incomplete.");
  }
  for (const [path, source] of Object.entries(artifact.modules)) {
    if (await hashReviewValue(new TextEncoder().encode(source)) !== emitted.get(path)) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Emitted module evidence mismatches the Artifact.");
    }
  }
  if (await hashReviewValue(new TextEncoder().encode(artifact.publicTypes)) !==
      bundle.artifact.publicDeclaration.hash ||
      `sha256:${artifact.sourceTypeHash}` !== bundle.source.declaration.hash) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Declaration evidence mismatches the Artifact.");
  }
  const parseCanonicalBlob = (reference: ReviewBlobReference): unknown => {
    const bytes = blobs.get(reference.hash);
    if (!bytes) throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Build evidence is missing.");
    const json = decoder.decode(bytes);
    const value = JSON.parse(json) as unknown;
    if (canonicalReviewJson(value) !== json) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Build evidence is not canonical.");
    }
    return value;
  };
  for (const reference of [bundle.artifact.publicExportedSurface, bundle.source.exportedSurface]) {
    const surface = parseCanonicalBlob(reference);
    if (!Array.isArray(surface) || !surface.every(value => typeof value === "string") ||
        surface.some((value, index) => index > 0 && value <= surface[index - 1]!)) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Exported surface evidence is invalid.");
    }
  }
  const lock = exact(parseCanonicalBlob(bundle.build.dependencyLock), ["entries"]);
  if (!Array.isArray(lock.entries) || lock.entries.length > REVIEW_LIMITS.dependencyEntries) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Dependency lock evidence is invalid.");
  }
  const directRequests = parseCanonicalBlob(bundle.build.directDependencyRequests);
  if (!Array.isArray(directRequests) || directRequests.length > REVIEW_LIMITS.dependencyEntries) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Direct dependency request evidence is invalid.");
  }
  const parsedRequests = directRequests.map((value) => {
    const request = exact(value, ["name", "version"]);
    return {
      name: boundedString(request.name, "dependency request name"),
      version: boundedString(request.version, "dependency request version"),
    };
  });
  if (canonicalReviewJson(parsedRequests) !== canonicalReviewJson(
    artifact.dependencies.map(({name, version}) => ({name, version})),
  )) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Direct dependency requests mismatch the Artifact.");
  }
  const trace = exact(parseCanonicalBlob(bundle.build.trace), ["artifactHash", "entries"]);
  if (trace.artifactHash !== artifact.hash || !Array.isArray(trace.entries) ||
      trace.entries.length > REVIEW_LIMITS.buildTraceEntries) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Build trace evidence is invalid.");
  }
  const toolchain = exact(parseCanonicalBlob(bundle.build.toolchain), ["components"]);
  if (!Array.isArray(toolchain.components)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Toolchain evidence is invalid.");
  }
  const componentNames = toolchain.components.map(value => {
    const component = exact(value, ["identity", "name"]);
    if (!isReviewHash(component.identity)) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Toolchain identity is invalid.");
    }
    return boundedString(component.name, "toolchain component");
  });
  for (const required of ["@gadgets/contractors", "esbuild", "typescript"]) {
    if (!componentNames.includes(required)) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", `Toolchain is missing ${required}.`);
    }
  }
  const recipe = exact(parseCanonicalBlob(bundle.build.recipe), [
    "authoringAbiHash", "compatibilityDate", "compatibilityFlags", "externals", "moduleFormat",
    "name", "platform", "publicRoot", "runtimeHarnessHash", "runtimeModuleSetHash",
    "runtimeProfileHash", "target",
  ]);
  const expectedRecipe = {
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
  };
  if (canonicalReviewJson(recipe) !== canonicalReviewJson(expectedRecipe)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Build recipe mismatches the Artifact runtime.");
  }
  const policyValue = record(parseCanonicalBlob(bundle.build.policySnapshot));
  const policy = exact(policyValue, [
    ...(policyValue.allowedPackages === undefined ? [] : ["allowedPackages"]),
    ...(policyValue.deniedPackages === undefined ? [] : ["deniedPackages"]),
    ...(policyValue.maxBundleBytes === undefined ? [] : ["maxBundleBytes"]),
  ]);
  const allowed = policy.allowedPackages;
  const denied = policy.deniedPackages;
  if ((allowed !== undefined && (!Array.isArray(allowed) ||
      !allowed.every(value => typeof value === "string"))) ||
      (denied !== undefined && (!Array.isArray(denied) ||
      !denied.every(value => typeof value === "string"))) ||
      (policy.maxBundleBytes !== undefined && (!Number.isSafeInteger(policy.maxBundleBytes) ||
      (policy.maxBundleBytes as number) < 1))) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Deployment policy evidence is invalid.");
  }
  const dependencyNames = artifact.dependencies.map(dependency => dependency.name);
  if (dependencyNames.some(name => (allowed && !(allowed as string[]).includes(name)) ||
      (denied as string[] | undefined)?.includes(name)) ||
      (typeof policy.maxBundleBytes === "number" &&
      Object.values(artifact.modules).reduce((sum, module) => sum + reviewUtf8Bytes(module), 0) >
      policy.maxBundleBytes)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Artifact violates its recorded deployment policy.");
  }
  for (const attestation of bundle.attestations) {
    if (attestation.artifactHash !== artifact.hash ||
        attestation.inputSetHash !== bundle.build.inputSetHash ||
        attestation.publicDeclarationHash !== bundle.artifact.publicDeclaration.hash ||
        attestation.publicExportedSurfaceHash !== bundle.artifact.publicExportedSurface.hash ||
        attestation.sourceDeclarationHash !== bundle.source.declaration.hash ||
        attestation.sourceExportedSurfaceHash !== bundle.source.exportedSurface.hash ||
        attestation.dependencyLockHash !== bundle.build.dependencyLock.hash ||
        attestation.directDependencyRequestsHash !== bundle.build.directDependencyRequests.hash ||
        attestation.toolchainHash !== bundle.build.toolchain.hash ||
        attestation.recipeHash !== bundle.build.recipe.hash ||
        attestation.buildTraceHash !== bundle.build.trace.hash) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Build attestation cross-reference mismatch.");
    }
  }
}

/** Parses one closed canonical Review Comparison. */
export function parseReviewComparison(json: string): ReviewComparison {
  const root = exact(parseCanonicalJson(json, REVIEW_LIMITS.comparisonBytes), [
    "baseline", "candidateBundleHash", "generator", "sections",
  ]);
  if (!isReviewHash(root.candidateBundleHash)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid candidate Review Bundle hash.");
  }
  const generator = exact(root.generator, ["identity", "name"]);
  if (!isReviewHash(generator.identity)) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid comparison generator identity.");
  }
  if (!Array.isArray(root.sections) || root.sections.length !== SECTION_NAMES.length) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid Review Comparison sections.");
  }
  let patchBytes = 0;
  const sections = root.sections.map((value, index): ReviewComparisonSection => {
    const item = record(value);
    const keys = ["change", "items", "name", ...(item.oldHash === undefined ? [] : ["oldHash"]),
      ...(item.newHash === undefined ? [] : ["newHash"])];
    exact(item, keys);
    if (item.name !== SECTION_NAMES[index] ||
        !["added", "removed", "modified", "unchanged"].includes(item.change as string) ||
        (item.oldHash !== undefined && !isReviewHash(item.oldHash)) ||
        (item.newHash !== undefined && !isReviewHash(item.newHash)) || !Array.isArray(item.items)) {
      throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid comparison section.");
    }
    const items = item.items.map(value => {
      const comparisonItem = record(value);
      exact(comparisonItem, [
        "change", "key", "kind",
        ...(comparisonItem.oldHash === undefined ? [] : ["oldHash"]),
        ...(comparisonItem.newHash === undefined ? [] : ["newHash"]),
        ...(comparisonItem.patch === undefined ? [] : ["patch"]),
        ...(comparisonItem.patchTruncated === undefined ? [] : ["patchTruncated"]),
        ...(comparisonItem.exportedSurface === undefined ? [] : ["exportedSurface"]),
      ]);
      if (!["text", "field", "dependency", "trace", "toolchain", "governance", "attestation"]
        .includes(comparisonItem.kind as string) ||
          !["added", "removed", "modified", "unchanged"]
            .includes(comparisonItem.change as string) ||
          (comparisonItem.oldHash !== undefined && !isReviewHash(comparisonItem.oldHash)) ||
          (comparisonItem.newHash !== undefined && !isReviewHash(comparisonItem.newHash)) ||
          (comparisonItem.patchTruncated !== undefined && comparisonItem.patchTruncated !== true)) {
        throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid comparison item.");
      }
      boundedString(comparisonItem.key, "comparison item key", REVIEW_LIMITS.pathBytes * 4);
      if (comparisonItem.patch !== undefined) {
        if (typeof comparisonItem.patch !== "string") {
          throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid comparison patch.");
        }
        patchBytes += reviewUtf8Bytes(comparisonItem.patch);
      }
      if (comparisonItem.exportedSurface !== undefined) {
        const surface = exact(comparisonItem.exportedSurface, [
          "added", "removed",
          ...(record(comparisonItem.exportedSurface).oldHash === undefined ? [] : ["oldHash"]),
          ...(record(comparisonItem.exportedSurface).newHash === undefined ? [] : ["newHash"]),
        ]);
        if (!Array.isArray(surface.added) || !Array.isArray(surface.removed) ||
            !surface.added.every(value => typeof value === "string") ||
            !surface.removed.every(value => typeof value === "string") ||
            (surface.oldHash !== undefined && !isReviewHash(surface.oldHash)) ||
            (surface.newHash !== undefined && !isReviewHash(surface.newHash))) {
          throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Invalid exported-surface comparison.");
        }
      }
      return comparisonItem;
    });
    return {...item, items} as unknown as ReviewComparisonSection;
  });
  if (patchBytes > REVIEW_LIMITS.renderedComparisonPatchBytes) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Rendered comparison patches exceed the limit.");
  }
  return freezeReviewValue({
    baseline: baseline(root.baseline),
    candidateBundleHash: root.candidateBundleHash,
    generator: {
      name: boundedString(generator.name, "comparison generator"),
      identity: generator.identity,
    },
    sections,
  });
}

/** Cryptographically verifies a canonical Review Comparison manifest identity. */
export async function verifyReviewComparisonManifest(
  json: string,
  expectedHash: string,
): Promise<void> {
  parseReviewComparison(json);
  if (!isReviewHash(expectedHash) || await hashReviewValue(new TextEncoder().encode(json)) !== expectedHash) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Review Comparison hash mismatch.");
  }
}
