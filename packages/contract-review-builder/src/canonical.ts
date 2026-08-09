const HASH = /^sha256:[0-9a-f]{64}$/;
const encoder = new TextEncoder();

/** Error raised when review evidence cannot be safely published. */
export class ReviewEvidenceError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "ISOLATION_FAILED"
      | "NON_REPRODUCIBLE"
      | "LIMIT_EXCEEDED"
      | "CORRUPT_EVIDENCE",
    message: string,
  ) {
    super(message);
    this.name = "ReviewEvidenceError";
  }
}

/** Returns whether a value is a canonical SHA-256 content identity. */
export function isReviewHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function assertCanonicalPrimitive(value: unknown): void {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new ReviewEvidenceError("INVALID_INPUT", "Review evidence numbers must be safe integers.");
  }
  if (typeof value === "string" && value !== value.normalize("NFC")) {
    throw new ReviewEvidenceError("INVALID_INPUT", "Review evidence strings must use NFC.");
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function" ||
      value === undefined) {
    throw new ReviewEvidenceError("INVALID_INPUT", "Review evidence contains an unsupported value.");
  }
}

/** Canonical UTF-8 JSON for immutable review evidence. */
export function canonicalReviewJson(value: unknown): string {
  assertCanonicalPrimitive(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalReviewJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).toSorted().map((key) => {
    if (key !== key.normalize("NFC")) {
      throw new ReviewEvidenceError("INVALID_INPUT", "Review evidence keys must use NFC.");
    }
    return `${JSON.stringify(key)}:${canonicalReviewJson(record[key])}`;
  }).join(",")}}`;
}

/** Computes the canonical SHA-256 identity of review evidence or exact bytes. */
export async function hashReviewValue(value: unknown | Uint8Array): Promise<string> {
  const bytes = value instanceof Uint8Array
    ? Uint8Array.from(value)
    : encoder.encode(canonicalReviewJson(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Returns the exact UTF-8 size of a string. */
export function reviewUtf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Deeply freezes a newly allocated evidence graph. */
export function freezeReviewValue<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeReviewValue(nested);
  return Object.freeze(value);
}

/** Read-only blob collection which never exposes its mutable backing bytes. */
export class ImmutableReviewBlobMap implements ReadonlyMap<string, Uint8Array> {
  readonly #values: Map<string, Uint8Array>;

  constructor(values: ReadonlyMap<string, Uint8Array>) {
    this.#values = new Map([...values].map(([key, value]) => [key, Uint8Array.from(value)]));
  }

  get size(): number { return this.#values.size; }
  has(key: string): boolean { return this.#values.has(key); }
  get(key: string): Uint8Array | undefined {
    const value = this.#values.get(key);
    return value && Uint8Array.from(value);
  }
  *entries(): MapIterator<[string, Uint8Array]> {
    for (const [key, value] of this.#values) yield [key, Uint8Array.from(value)];
  }
  keys(): MapIterator<string> { return this.#values.keys(); }
  *values(): MapIterator<Uint8Array> {
    for (const value of this.#values.values()) yield Uint8Array.from(value);
  }
  [Symbol.iterator](): MapIterator<[string, Uint8Array]> { return this.entries(); }
  forEach(callbackfn: (value: Uint8Array, key: string, map: ReadonlyMap<string, Uint8Array>) => void): void {
    for (const [key, value] of this) callbackfn(value, key, this);
  }
  get [Symbol.toStringTag](): string { return "ImmutableReviewBlobMap"; }
}
