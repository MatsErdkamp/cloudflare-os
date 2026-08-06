import type { ContractArtifact } from "../artifact/contract-artifact.js";
import { canonicalContractJson } from "../artifact/hash-artifact.js";

/** Content-addressed persistence chosen by the embedding host, normally R2. */
export interface ArtifactStore {
  get(hash: string): Promise<ContractArtifact | undefined>;
  put(artifact: ContractArtifact): Promise<void>;
}

function authority(artifact: ContractArtifact): Omit<ContractArtifact, "hash" | "createdAt"> {
  const {hash: _hash, createdAt: _createdAt, ...value} = artifact;
  return value;
}

/** Deterministic test and local-development artifact store. */
export class InMemoryArtifactStore implements ArtifactStore {
  readonly #artifacts = new Map<string, ContractArtifact>();

  async get(hash: string): Promise<ContractArtifact | undefined> {
    return this.#artifacts.get(hash);
  }

  async put(artifact: ContractArtifact): Promise<void> {
    const existing = this.#artifacts.get(artifact.hash);
    if (existing &&
        canonicalContractJson(authority(existing)) !== canonicalContractJson(authority(artifact))) {
      throw new Error(`Artifact store already contains different content for ${artifact.hash}.`);
    }
    if (!existing) this.#artifacts.set(artifact.hash, artifact);
  }
}
