import { describe, expect, it } from "vitest";

import {
  ContractSharedState,
  InMemoryArtifactStore,
  type SharedStateBackend,
} from "../src/host/index";
import type { ContractArtifact } from "../src/artifact/index";

function artifact(hash: string): ContractArtifact {
  return {
    hash,
    mainModule: "contract.js",
    modules: { "contract.js": "export default () => ({})" },
    publicTypes: "export interface ContractBinding {}",
    publicRootType: "ContractBinding",
    sourceTypeHash: "source",
    sourceRootType: "Source",
    dependencies: [],
    runtimeProfileHash: "sha256:profile",
    runtimeProfile: {
      profile: "cloudflare-workers-dynamic",
      compatibilityDate: "2026-08-05",
      compatibilityFlags: [],
      globalOutbound: "none",
      runtimeHarnessHash: "sha256:harness",
      runtimeModuleSetHash: "sha256:modules",
      authoringAbi: { declarationHash: "sha256:abi" },
      lifecycle: {
      maxCompositionDepth: 8,
      observerDrainTimeoutMs: 1_000,
        rawReadableStreams: "unsupported",
        rawWritableStreams: "unsupported",
        rawTransformStreams: "unsupported",
        rawAsyncIterators: "unsupported",
        rawAbortSignals: "unsupported",
        upstreamCancellation: "mediated",
      },
    },
  };
}

describe("Contract host storage", () => {
  it("stores immutable artifacts by hash and refuses conflicting contents", async () => {
    const store = new InMemoryArtifactStore();
    const first = artifact("sha256:first");
    await store.put(first);
    await store.put(first);

    await expect(store.put({ ...first, modules: { "contract.js": "changed" } }))
      .rejects.toThrow("already contains different content");
    await expect(store.get("sha256:first")).resolves.toEqual(first);
  });

  it("namespaces shared structured state and rejects nested live capabilities", async () => {
    const values = new Map<string, unknown>();
    const backend: SharedStateBackend = {
      get: async (key) => values.get(key),
      put: async (key, value) => { values.set(key, value); },
      delete: async (key) => { values.delete(key); },
    };
    const left = new ContractSharedState("team", backend);
    const right = new ContractSharedState("other", backend);

    await left.put("counter", { value: 2, tags: ["safe"] });
    await left.put("collections", new Map([["safe", new Set([1, 2])]]));
    await expect(left.get("counter")).resolves.toEqual({ value: 2, tags: ["safe"] });
    await expect(left.get("collections")).resolves.toEqual(new Map([["safe", new Set([1, 2])]]));
    await expect(right.get("counter")).resolves.toBeUndefined();
    await expect(left.put("callback", { nested: { invoke() {} } })).rejects.toThrow(
      "structured data",
    );
    await expect(left.put("mappedCallback", new Map([["unsafe", () => undefined]])))
      .rejects.toThrow("structured data");
  });
});
