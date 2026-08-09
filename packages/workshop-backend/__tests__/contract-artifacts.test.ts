import { describe, expect, it } from "vitest";

import type {ContractArtifact} from "@gadgets/contractors/artifact";
import { R2ContractArtifactStore, type ContractArtifactBucket } from "../src/contract-artifacts";
import {currentContractArtifact} from "./contract-artifact-fixture";

async function artifact(): Promise<ContractArtifact> {
  return currentContractArtifact();
}

class MemoryBucket implements ContractArtifactBucket {
  readonly values = new Map<string, string>();
  lastOnlyIf: string | undefined;

  async get(key: string) {
    const value = this.values.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key: string, value: string, options?: {onlyIf: {etagDoesNotMatch: string}}) {
    this.lastOnlyIf = options?.onlyIf.etagDoesNotMatch;
    if (options && this.values.has(key)) return null;
    this.values.set(key, value);
    return {key};
  }
}

describe("R2ContractArtifactStore", () => {
  it("stores and retrieves immutable artifacts under their content-addressed key", async () => {
    const bucket = new MemoryBucket();
    const store = new R2ContractArtifactStore(bucket);
    const value = await artifact();

    await store.put(value);

    expect([...bucket.values.keys()]).toEqual([`contracts/artifacts/${value.hash}.json`]);
    expect(bucket.lastOnlyIf).toBe("*");
    await expect(store.get(value.hash)).resolves.toEqual(value);
  });

  it("treats an identical current Artifact as the same content-addressed authority", async () => {
    const bucket = new MemoryBucket();
    const store = new R2ContractArtifactStore(bucket);
    const first = await artifact();
    const rebuilt = await artifact();

    await store.put(first);
    await expect(store.put(rebuilt)).resolves.toBeUndefined();
    await expect(store.get(first.hash)).resolves.toEqual(first);
  });

  it("rejects invalid hashes and conflicting R2 contents", async () => {
    const bucket = new MemoryBucket();
    const store = new R2ContractArtifactStore(bucket);
    await expect(store.get("latest")).rejects.toThrow("Invalid Contract artifact hash");

    const value = await artifact();
    await store.put(value);
    bucket.values.set(`contracts/artifacts/${value.hash}.json`, JSON.stringify({
      ...value,
      publicTypes: "changed",
    }));
    await expect(store.get(value.hash)).rejects.toThrow("content does not match");
    await expect(store.put(value)).rejects.toThrow("content does not match");
  });

  it("rejects a write whose claimed content hash is false", async () => {
    const store = new R2ContractArtifactStore(new MemoryBucket());
    const value = await artifact();

    await expect(store.put({...value, hash: `sha256:${"a".repeat(64)}`}))
      .rejects.toThrow("content does not match");
  });
});
