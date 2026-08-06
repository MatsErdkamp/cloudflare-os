import type { SharedContractState } from "../authoring/contract-context.js";

/** Manager-owned structured key-value persistence used by explicitly shared instances. */
export interface SharedStateBackend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Rejects capability-bearing values before they enter Manager-owned shared persistence. */
export function assertContractStructuredData(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Shared Contract state accepts structured data, not live capabilities.");
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertContractStructuredData(item, seen);
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      assertContractStructuredData(key, seen);
      assertContractStructuredData(item, seen);
    }
    return;
  }
  if (value instanceof Set) {
    for (const item of value) assertContractStructuredData(item, seen);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("Shared Contract state accepts structured data, not live capabilities.");
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    assertContractStructuredData(item, seen);
  }
}

/** Namespace-scoped shared state capability supplied only to opted-in Contract instances. */
export class ContractSharedState implements SharedContractState {
  readonly #namespace: string;
  readonly #backend: SharedStateBackend;

  constructor(
    namespace: string,
    backend: SharedStateBackend,
  ) {
    if (!namespace) throw new TypeError("Shared Contract state namespace must not be empty.");
    this.#namespace = namespace;
    this.#backend = backend;
  }

  #key(key: string): string {
    if (!key) throw new TypeError("Shared Contract state key must not be empty.");
    return `${this.#namespace}\u0000${key}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return await this.#backend.get(this.#key(key)) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    assertContractStructuredData(value);
    await this.#backend.put(this.#key(key), value);
  }

  async delete(key: string): Promise<void> {
    await this.#backend.delete(this.#key(key));
  }
}
