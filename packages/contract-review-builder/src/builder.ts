import {hashArtifact} from "@gadgets/contractors/artifact";
import type {ContractArtifact, ContractBuildCandidate} from "@gadgets/contractors/artifact";

import {
  canonicalReviewJson,
  freezeReviewValue,
  hashReviewValue,
  ImmutableReviewBlobMap,
  isReviewHash,
  ReviewEvidenceError,
  reviewUtf8Bytes,
} from "./canonical.js";
import {createReviewComparison} from "./comparison.js";
import {REVIEW_LIMITS} from "./limits.js";
import {
  parseContractReviewBundle,
  parseReviewComparison,
  verifyContractReviewBlobs,
} from "./parser.js";
import type {
  BuildContractReviewEvidenceInput,
  BuiltContractReviewEvidence,
  ContractReviewBundle,
  ReviewBlobReference,
  ReviewBuildAttestation,
  ReviewBuildRunResult,
  ReviewBuildRunnerFactory,
  ReviewDependencyLock,
  ReviewToolchainIdentity,
} from "./types.js";

const encoder = new TextEncoder();

function exactArtifactAuthority(artifact: ContractArtifact): Omit<ContractArtifact, "hash"> {
  const {hash: _hash, ...authority} = artifact;
  return authority;
}

async function assertArtifactIdentity(candidate: ContractBuildCandidate): Promise<void> {
  if (await hashArtifact(exactArtifactAuthority(candidate.artifact)) !== candidate.artifact.hash ||
      candidate.trace.artifactHash !== candidate.artifact.hash) {
    throw new ReviewEvidenceError("NON_REPRODUCIBLE", "A runner returned an invalid Artifact identity.");
  }
  if (candidate.trace.entries.length > REVIEW_LIMITS.buildTraceEntries) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Build trace exceeds the protocol limit.");
  }
}

function assertSortedUnique(values: readonly string[], label: string): void {
  if (values.some((value, index) => index > 0 && value <= values[index - 1]!)) {
    throw new ReviewEvidenceError("INVALID_INPUT", `${label} must be sorted and unique.`);
  }
}

function validateDependencyLock(lock: ReviewDependencyLock): void {
  if (lock.entries.length > REVIEW_LIMITS.dependencyEntries) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Dependency lock exceeds the protocol limit.");
  }
  assertSortedUnique(
    lock.entries.map(entry => `${entry.name}@${entry.version}`),
    "Dependency lock entries",
  );
  for (const entry of lock.entries) {
    if (!entry.name || !entry.version || !entry.integrity || !isReviewHash(entry.packageContentHash)) {
      throw new ReviewEvidenceError("INVALID_INPUT", "Dependency lock contains an invalid identity.");
    }
    if (entry.dependencies) assertSortedUnique(entry.dependencies, "Dependency edges");
  }
}

function validateToolchain(toolchain: ReviewToolchainIdentity): void {
  assertSortedUnique(toolchain.components.map(component => component.name), "Toolchain components");
  const names = new Set(toolchain.components.map(component => component.name));
  for (const required of ["@gadgets/contractors", "esbuild", "typescript"]) {
    if (!names.has(required)) {
      throw new ReviewEvidenceError("INVALID_INPUT", `Toolchain is missing ${required}.`);
    }
  }
  if (toolchain.components.some(component => !isReviewHash(component.identity))) {
    throw new ReviewEvidenceError("INVALID_INPUT", "Toolchain contains an invalid component identity.");
  }
}

function validateRun(role: "candidate" | "verifier", result: ReviewBuildRunResult): void {
  if (result.isolation.role !== role || result.isolation.network !== "disabled" ||
      result.isolation.mutableState !== "fresh" || result.isolation.networkAttempts !== 0) {
    throw new ReviewEvidenceError("ISOLATION_FAILED", `${role} runner did not remain network-disabled and fresh.`);
  }
  validateDependencyLock(result.dependencyLock);
  validateToolchain(result.toolchain);
  assertSortedUnique(
    result.directDependencyRequests.map(request => request.name),
    "Direct dependency requests",
  );
  if (result.directDependencyRequests.some(request => !request.name || !request.version)) {
    throw new ReviewEvidenceError("INVALID_INPUT", "Direct dependency request is invalid.");
  }
}

async function addBlob(
  blobs: Map<string, Uint8Array>,
  value: string,
  mediaType: ReviewBlobReference["mediaType"],
): Promise<ReviewBlobReference> {
  const bytes = encoder.encode(value);
  const hash = await hashReviewValue(bytes);
  const existing = blobs.get(hash);
  if (existing && (existing.byteLength !== bytes.byteLength ||
      existing.some((byte, index) => byte !== bytes[index]))) {
    throw new ReviewEvidenceError("CORRUPT_EVIDENCE", "Content hash collision has conflicting bytes.");
  }
  blobs.set(hash, bytes);
  return {hash, bytes: bytes.byteLength, mediaType};
}

async function attestation(
  result: ReviewBuildRunResult,
  inputSetHash: string,
  dependencyLockHash: string,
  directDependencyRequestsHash: string,
  toolchainHash: string,
  recipeHash: string,
  buildTraceHash: string,
  publicDeclarationHash: string,
  sourceDeclarationHash: string,
): Promise<ReviewBuildAttestation> {
  return {
    ...result.isolation,
    inputSetHash,
    artifactHash: result.candidate.artifact.hash,
    publicDeclarationHash,
    sourceDeclarationHash,
    dependencyLockHash,
    directDependencyRequestsHash,
    toolchainHash,
    recipeHash,
    buildTraceHash,
  };
}

function assertManifestCap(json: string, limit: number, label: string): void {
  if (reviewUtf8Bytes(json) > limit) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", `${label} exceeds the protocol size limit.`);
  }
}

/** Produces bounded immutable review evidence after two independent exact builds agree. */
export async function buildContractReviewEvidence(
  input: BuildContractReviewEvidenceInput,
  runnerFactory: ReviewBuildRunnerFactory,
): Promise<BuiltContractReviewEvidence> {
  if (canonicalReviewJson(input.policySnapshot) !==
      canonicalReviewJson(input.inputs.organizationPolicy ?? {})) {
    throw new ReviewEvidenceError(
      "INVALID_INPUT",
      "Deployment policy snapshot does not match the policy evaluated by the compiler.",
    );
  }
  const candidateRunner = runnerFactory.create({
    role: "candidate",
    network: "disabled",
    mutableState: "fresh",
  });
  const verifierRunner = runnerFactory.create({
    role: "verifier",
    network: "disabled",
    mutableState: "fresh",
  });
  let candidateRun: ReviewBuildRunResult;
  let verifierRun: ReviewBuildRunResult;
  try {
    [candidateRun, verifierRun] = await Promise.all([
      candidateRunner.build({inputs: freezeReviewValue(structuredClone(input.inputs))}),
      verifierRunner.build({inputs: freezeReviewValue(structuredClone(input.inputs))}),
    ]);
  } finally {
    candidateRunner[Symbol.dispose]();
    verifierRunner[Symbol.dispose]();
  }
  validateRun("candidate", candidateRun);
  validateRun("verifier", verifierRun);
  for (const [role, run] of [["candidate", candidateRun], ["verifier", verifierRun]] as const) {
    if (canonicalReviewJson(run.candidate.inputs) !== canonicalReviewJson(input.inputs)) {
      throw new ReviewEvidenceError(
        "NON_REPRODUCIBLE",
        `${role} runner did not compile the exact declared input set.`,
      );
    }
  }
  if (candidateRun.isolation.environmentIdentity === verifierRun.isolation.environmentIdentity) {
    throw new ReviewEvidenceError("ISOLATION_FAILED", "Candidate and verifier shared mutable build state.");
  }
  await Promise.all([
    assertArtifactIdentity(candidateRun.candidate),
    assertArtifactIdentity(verifierRun.candidate),
  ]);

  const compared = [
    ["Artifact", candidateRun.candidate.artifact, verifierRun.candidate.artifact],
    ["dependency lock", candidateRun.dependencyLock, verifierRun.dependencyLock],
    ["direct dependency requests", candidateRun.directDependencyRequests,
      verifierRun.directDependencyRequests],
    ["toolchain", candidateRun.toolchain, verifierRun.toolchain],
    ["recipe", candidateRun.recipe, verifierRun.recipe],
    ["build trace", candidateRun.candidate.trace, verifierRun.candidate.trace],
  ] as const;
  for (const [label, candidate, verifier] of compared) {
    if (canonicalReviewJson(candidate) !== canonicalReviewJson(verifier)) {
      throw new ReviewEvidenceError("NON_REPRODUCIBLE", `Candidate and verifier ${label} differ.`);
    }
  }

  const blobs = new Map<string, Uint8Array>();
  const originalModules = await Promise.all(Object.entries(input.inputs.modules)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(async ([path, source]) => ({
      path,
      blob: await addBlob(blobs, source, "text/typescript"),
    })));
  const emittedModules = await Promise.all(Object.entries(candidateRun.candidate.artifact.modules)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(async ([path, source]) => ({
      path,
      blob: await addBlob(blobs, source, "text/javascript"),
    })));
  const artifactAuthority = await addBlob(
    blobs,
    canonicalReviewJson(candidateRun.candidate.artifact),
    "application/json",
  );
  const publicDeclaration = await addBlob(
    blobs,
    candidateRun.candidate.artifact.publicTypes,
    "text/typescript",
  );
  const sourceDeclaration = await addBlob(blobs, input.inputs.sourceTypes, "text/typescript");
  const dependencyLock = await addBlob(
    blobs,
    canonicalReviewJson(candidateRun.dependencyLock),
    "application/json",
  );
  const directDependencyRequests = await addBlob(
    blobs,
    canonicalReviewJson(candidateRun.directDependencyRequests),
    "application/json",
  );
  const toolchain = await addBlob(
    blobs,
    canonicalReviewJson(candidateRun.toolchain),
    "application/json",
  );
  const recipe = await addBlob(blobs, canonicalReviewJson(candidateRun.recipe), "application/json");
  const trace = await addBlob(
    blobs,
    canonicalReviewJson(candidateRun.candidate.trace),
    "application/json",
  );
  const policySnapshot = await addBlob(
    blobs,
    canonicalReviewJson(input.policySnapshot),
    "application/json",
  );
  const inputSetHash = await hashReviewValue(input.inputs);
  const candidateAttestation = await attestation(
    candidateRun,
    inputSetHash,
    dependencyLock.hash,
    directDependencyRequests.hash,
    toolchain.hash,
    recipe.hash,
    trace.hash,
    publicDeclaration.hash,
    sourceDeclaration.hash,
  );
  const verifierAttestation = await attestation(
    verifierRun,
    inputSetHash,
    dependencyLock.hash,
    directDependencyRequests.hash,
    toolchain.hash,
    recipe.hash,
    trace.hash,
    publicDeclaration.hash,
    sourceDeclaration.hash,
  );
  const bundle: ContractReviewBundle = {
    artifact: {
      hash: candidateRun.candidate.artifact.hash,
      authority: artifactAuthority,
      emittedModules,
      publicDeclaration,
    },
    originalModules,
    source: {
      declaration: sourceDeclaration,
      rootType: input.inputs.sourceRootType,
      typeHash: candidateRun.candidate.artifact.sourceTypeHash,
    },
    build: {
      mainModule: input.inputs.mainModule,
      inputSetHash,
      dependencyLock,
      directDependencyRequests,
      toolchain,
      recipe,
      trace,
      policySnapshot,
    },
    provenance: structuredClone(input.submittedProvenance),
    attestations: [candidateAttestation, verifierAttestation],
    reproducibility: "reproduced",
    baseline: structuredClone(input.baseline),
  };
  const bundleJson = canonicalReviewJson(bundle);
  assertManifestCap(bundleJson, REVIEW_LIMITS.manifestBytes, "Review Bundle");
  const bundleHash = await hashReviewValue(encoder.encode(bundleJson));
  const parsedBundle = parseContractReviewBundle(bundleJson);
  await verifyContractReviewBlobs(parsedBundle, blobs);
  if (input.baselineBundle && input.baselineBlobs) {
    await verifyContractReviewBlobs(input.baselineBundle, input.baselineBlobs);
  }

  const comparison = await createReviewComparison(
    input.baseline,
    input.baselineBundle,
    input.baselineBlobs,
    parsedBundle,
    blobs,
    bundleHash,
    input.comparisonGenerator,
  );
  const comparisonJson = canonicalReviewJson(comparison);
  assertManifestCap(comparisonJson, REVIEW_LIMITS.comparisonBytes, "Review Comparison");
  const comparisonHash = await hashReviewValue(encoder.encode(comparisonJson));
  const parsedComparison = parseReviewComparison(comparisonJson);
  if ([...blobs.values()].reduce((sum, value) => sum + value.byteLength, 0) >
      REVIEW_LIMITS.totalUniqueBlobBytes) {
    throw new ReviewEvidenceError("LIMIT_EXCEEDED", "Review blobs exceed the total size limit.");
  }
  return freezeReviewValue({
    candidate: candidateRun.candidate,
    bundle: parsedBundle,
    bundleJson,
    bundleHash,
    comparison: parsedComparison,
    comparisonJson,
    comparisonHash,
    blobs: new ImmutableReviewBlobMap(blobs),
  });
}
