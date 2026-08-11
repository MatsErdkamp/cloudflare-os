import {
  REVIEW_LIMITS,
  ReviewEvidenceError,
  canonicalReviewJson,
  hashReviewValue,
  parseContractReviewBundle,
  parseReviewComparison,
  verifyContractReviewBlobs,
  type BuiltContractReviewEvidence,
  type ContractReviewBundle,
  type ReviewBlobReference,
  type ReviewComparison,
} from "@gadgets/contract-review-builder";

/** Minimal R2 surface required by immutable Contract review evidence persistence. */
export interface ContractReviewEvidenceBucket {
  get(key: string): Promise<{
    readonly size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  put(
    key: string,
    value: Uint8Array | string,
    options?: {onlyIf: {etagDoesNotMatch: string}},
  ): Promise<unknown | null>;
}

const encoder = new TextEncoder();

function corrupt(message: string): ReviewEvidenceError {
  return new ReviewEvidenceError("CORRUPT_EVIDENCE", message);
}

function requireHash(hash: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(hash)) {
    throw corrupt(`Invalid Contract review evidence hash: ${hash}`);
  }
}

function blobKey(hash: string): string {
  requireHash(hash);
  return `contracts/review/blobs/${hash}`;
}

function bundleKey(hash: string): string {
  requireHash(hash);
  return `contracts/review/bundles/${hash}.json`;
}

function comparisonKey(hash: string): string {
  requireHash(hash);
  return `contracts/review/comparisons/${hash}.json`;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function bundleBlobReferences(bundle: ContractReviewBundle): readonly ReviewBlobReference[] {
  return [
    bundle.artifact.authority,
    ...bundle.artifact.emittedModules.map(module => module.blob),
    bundle.artifact.publicDeclaration,
    ...bundle.originalModules.map(module => module.blob),
    bundle.source.declaration,
    bundle.build.dependencyLock,
    bundle.build.directDependencyRequests,
    bundle.build.toolchain,
    bundle.build.recipe,
    bundle.build.trace,
    bundle.build.policySnapshot,
  ];
}

function uniqueBlobReferences(bundle: ContractReviewBundle): ReadonlyMap<string, ReviewBlobReference> {
  const references = new Map<string, ReviewBlobReference>();
  for (const reference of bundleBlobReferences(bundle)) {
    const previous = references.get(reference.hash);
    if (previous && (previous.bytes !== reference.bytes || previous.mediaType !== reference.mediaType)) {
      throw corrupt(`Conflicting Contract review blob reference: ${reference.hash}`);
    }
    references.set(reference.hash, reference);
  }
  return references;
}

function assertComparisonReferences(
  comparison: ReviewComparison,
  comparisonBundleHash: string,
  bundle: ContractReviewBundle,
): void {
  if (comparison.candidateBundleHash !== comparisonBundleHash) {
    throw corrupt("Review Comparison cites a different candidate Review Bundle.");
  }
  if (canonicalReviewJson(comparison.baseline) !== canonicalReviewJson(bundle.baseline)) {
    throw corrupt("Review Comparison baseline differs from its candidate Review Bundle.");
  }
}

/** Immutable R2 adapter for the sole current Contract Review Bundle and Comparison formats. */
export class R2ContractReviewEvidenceStore {
  constructor(private readonly bucket: ContractReviewEvidenceBucket) {}

  /** Publishes verified blobs first, then its Bundle and Comparison manifests create-only. */
  async put(evidence: BuiltContractReviewEvidence): Promise<void> {
    await this.#assertManifestHash(evidence.bundleJson, evidence.bundleHash, "Review Bundle");
    await this.#assertManifestHash(
      evidence.comparisonJson,
      evidence.comparisonHash,
      "Review Comparison",
    );
    const bundle = parseContractReviewBundle(evidence.bundleJson);
    const comparison = parseReviewComparison(evidence.comparisonJson);
    assertComparisonReferences(comparison, evidence.bundleHash, bundle);
    await verifyContractReviewBlobs(bundle, evidence.blobs);

    const references = uniqueBlobReferences(bundle);
    if (evidence.blobs.size !== references.size ||
        [...evidence.blobs.keys()].some(hash => !references.has(hash))) {
      throw corrupt("Contract review evidence contains undeclared blobs.");
    }
    for (const [hash, reference] of references) {
      const bytes = evidence.blobs.get(hash);
      if (!bytes || bytes.byteLength !== reference.bytes) {
        throw corrupt(`Missing or length-mismatched Contract review blob: ${hash}`);
      }
      await this.#putImmutable(blobKey(hash), bytes);
    }
    await this.#putImmutable(bundleKey(evidence.bundleHash), encoder.encode(evidence.bundleJson));
    await this.#putImmutable(
      comparisonKey(evidence.comparisonHash),
      encoder.encode(evidence.comparisonJson),
    );
  }

  /** Loads a Bundle only after validating its canonical bytes and every referenced blob. */
  async getBundle(hash: string): Promise<ContractReviewBundle | undefined> {
    const encoded = await this.#getBytes(bundleKey(hash), REVIEW_LIMITS.manifestBytes);
    if (!encoded) return undefined;
    const json = this.#decodeJson(encoded, "Review Bundle");
    await this.#assertManifestHash(json, hash, "Review Bundle");
    const bundle = parseContractReviewBundle(json);
    const blobs = new Map<string, Uint8Array>();
    for (const reference of uniqueBlobReferences(bundle).values()) {
      blobs.set(reference.hash, await this.#requireBlob(reference));
    }
    await verifyContractReviewBlobs(bundle, blobs);
    return bundle;
  }

  /** Loads a Comparison only after validating its exact candidate Bundle cross-reference. */
  async getComparison(hash: string): Promise<ReviewComparison | undefined> {
    const encoded = await this.#getBytes(comparisonKey(hash), REVIEW_LIMITS.comparisonBytes);
    if (!encoded) return undefined;
    const json = this.#decodeJson(encoded, "Review Comparison");
    await this.#assertManifestHash(json, hash, "Review Comparison");
    const comparison = parseReviewComparison(json);
    const bundle = await this.getBundle(comparison.candidateBundleHash);
    if (!bundle) throw corrupt("Review Comparison candidate Bundle is missing.");
    assertComparisonReferences(comparison, comparison.candidateBundleHash, bundle);
    return comparison;
  }

  /** Loads and validates one exact content-addressed Review Bundle blob. */
  async getBlob(reference: ReviewBlobReference): Promise<Uint8Array | undefined> {
    requireHash(reference.hash);
    if (!Number.isSafeInteger(reference.bytes) || reference.bytes < 0 ||
        reference.bytes > REVIEW_LIMITS.totalUniqueBlobBytes) {
      throw corrupt("Contract review blob length exceeds protocol limits.");
    }
    const bytes = await this.#getBytes(blobKey(reference.hash), reference.bytes);
    if (!bytes) return undefined;
    await this.#assertBlob(reference, bytes);
    return bytes;
  }

  async #requireBlob(reference: ReviewBlobReference): Promise<Uint8Array> {
    const bytes = await this.getBlob(reference);
    if (!bytes) throw corrupt(`Contract review blob is missing: ${reference.hash}`);
    return bytes;
  }

  async #assertBlob(reference: ReviewBlobReference, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength !== reference.bytes) {
      throw corrupt(`Contract review blob length mismatch: ${reference.hash}`);
    }
    if (await hashReviewValue(bytes) !== reference.hash) {
      throw corrupt(`Contract review blob hash mismatch: ${reference.hash}`);
    }
  }

  async #assertManifestHash(json: string, expectedHash: string, kind: string): Promise<void> {
    requireHash(expectedHash);
    if (await hashReviewValue(encoder.encode(json)) !== expectedHash) {
      throw corrupt(`${kind} hash mismatch.`);
    }
  }

  async #putImmutable(key: string, bytes: Uint8Array): Promise<void> {
    const existing = await this.#getBytes(key, bytes.byteLength);
    if (existing) {
      if (!sameBytes(existing, bytes)) throw corrupt(`Conflicting Contract review evidence at ${key}`);
      return;
    }
    const created = await this.bucket.put(key, bytes, {onlyIf: {etagDoesNotMatch: "*"}});
    if (created !== null) return;
    const winner = await this.#getBytes(key, bytes.byteLength);
    if (!winner || !sameBytes(winner, bytes)) {
      throw corrupt(`Conflicting Contract review evidence race at ${key}`);
    }
  }

  async #getBytes(key: string, maximumBytes: number): Promise<Uint8Array | undefined> {
    const object = await this.bucket.get(key);
    if (!object) return undefined;
    if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > maximumBytes) {
      throw corrupt(`Contract review evidence at ${key} exceeds its byte limit.`);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength !== object.size) {
      throw corrupt(`Contract review evidence at ${key} changed while reading.`);
    }
    return bytes;
  }

  #decodeJson(bytes: Uint8Array, kind: string): string {
    try {
      return new TextDecoder("utf-8", {fatal: true, ignoreBOM: false}).decode(bytes);
    } catch {
      throw corrupt(`${kind} is not valid UTF-8.`);
    }
  }
}
