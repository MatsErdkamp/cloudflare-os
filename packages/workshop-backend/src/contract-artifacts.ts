import {
  canonicalContractJson,
  assertCurrentContractArtifact,
  parseContractArtifact,
  type ContractArtifact,
} from "@gadgets/contractors/artifact";

/** Minimal R2 surface used by the immutable Contract artifact store. */
export interface ContractArtifactBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(
    key: string,
    value: string,
    options?: {onlyIf: {etagDoesNotMatch: string}},
  ): Promise<unknown | null>;
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function artifactKey(hash: string): string {
  if (!HASH_PATTERN.test(hash)) throw new TypeError(`Invalid Contract artifact hash: ${hash}`);
  return `contracts/artifacts/${hash}.json`;
}

function parseArtifact(text: string, expectedHash: string): ContractArtifact {
  const artifact = parseContractArtifact(JSON.parse(text));
  if (artifact.hash !== expectedHash) throw new TypeError("Invalid Contract artifact hash.");
  return artifact;
}

async function assertArtifactHash(artifact: ContractArtifact): Promise<void> {
  await assertCurrentContractArtifact(artifact);
}

function artifactAuthority(artifact: ContractArtifact): Omit<ContractArtifact, "hash"> {
  const {hash: _hash, ...authority} = artifact;
  return authority;
}

async function hasSameAuthority(text: string, artifact: ContractArtifact): Promise<boolean> {
  const existing = parseArtifact(text, artifact.hash);
  await assertArtifactHash(existing);
  return canonicalContractJson(artifactAuthority(existing)) ===
    canonicalContractJson(artifactAuthority(artifact));
}

/** Immutable Contract artifact persistence using the deployment's R2 content bucket. */
export class R2ContractArtifactStore {
  constructor(private readonly bucket: ContractArtifactBucket) {}

  async get(hash: string): Promise<ContractArtifact | undefined> {
    const object = await this.bucket.get(artifactKey(hash));
    if (!object) return undefined;
    const artifact = parseArtifact(await object.text(), hash);
    await assertArtifactHash(artifact);
    return artifact;
  }

  async put(artifact: ContractArtifact): Promise<void> {
    const key = artifactKey(artifact.hash);
    await assertArtifactHash(artifact);
    const encoded = JSON.stringify(artifact);
    const existing = await this.bucket.get(key);
    if (existing) {
      const current = await existing.text();
      if (!await hasSameAuthority(current, artifact)) {
        throw new Error(`Contract artifact store already contains different content for ${artifact.hash}.`);
      }
      return;
    }
    const created = await this.bucket.put(
      key,
      encoded,
      {onlyIf: {etagDoesNotMatch: "*"}},
    );
    if (created === null) {
      const winner = await this.bucket.get(key);
      if (!winner || !await hasSameAuthority(await winner.text(), artifact)) {
        throw new Error(`Contract artifact store already contains different content for ${artifact.hash}.`);
      }
    }
  }
}
