import {
  canonicalContractJson,
  hashArtifact,
  type ContractArtifact,
} from "@gadgets/contractors/runtime";

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

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string");
}

function parseArtifact(text: string, expectedHash: string): ContractArtifact {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid Contract artifact.");
  }
  const record = value as Record<string, unknown>;
  if (record.hash !== expectedHash || typeof record.mainModule !== "string" ||
      !isStringRecord(record.modules) || typeof record.publicTypes !== "string" ||
      record.publicRootType !== "ContractBinding" || typeof record.sourceTypeHash !== "string" ||
      typeof record.sourceRootType !== "string" || !Array.isArray(record.dependencies) ||
      !record.dependencies.every((item) => typeof item === "object" && item !== null &&
        typeof (item as Record<string, unknown>).name === "string" &&
        typeof (item as Record<string, unknown>).version === "string" &&
        ((item as Record<string, unknown>).integrity === undefined ||
          typeof (item as Record<string, unknown>).integrity === "string")) ||
      typeof record.compatibilityDate !== "string" ||
      typeof record.runtimeHarnessVersion !== "string" ||
      typeof record.createdAt !== "string") {
    throw new TypeError("Invalid Contract artifact.");
  }
  return {
    hash: record.hash as string,
    mainModule: record.mainModule,
    modules: record.modules,
    publicTypes: record.publicTypes,
    publicRootType: record.publicRootType,
    sourceTypeHash: record.sourceTypeHash,
    sourceRootType: record.sourceRootType,
    dependencies: record.dependencies as ContractArtifact["dependencies"],
    compatibilityDate: record.compatibilityDate,
    runtimeHarnessVersion: record.runtimeHarnessVersion as string,
    createdAt: record.createdAt,
  };
}

async function assertArtifactHash(artifact: ContractArtifact): Promise<void> {
  const {hash, createdAt: _createdAt, ...authority} = artifact;
  if (await hashArtifact(authority) !== hash) {
    throw new Error(`Contract artifact content does not match ${hash}.`);
  }
}

function artifactAuthority(artifact: ContractArtifact): Omit<ContractArtifact, "hash" | "createdAt"> {
  const {hash: _hash, createdAt: _createdAt, ...authority} = artifact;
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
