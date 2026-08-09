import type {
  ContractInvocationEvidence,
  ContractInvocationEvidenceInput,
} from "../runtime/contract-invocation.js";

function nonEmpty(name: string, value: string): void {
  if (value.length === 0) throw new TypeError(`${name} must not be empty.`);
}

const GENERATION_FIELDS = [
  "consumer",
  "binding",
  "contractInstance",
  "environment",
  "authority",
] as const;

/** Mints one frozen closed invocation record from host-owned generation state. */
export function createContractInvocationEvidence(
  input: ContractInvocationEvidenceInput,
): ContractInvocationEvidence {
  const allowed = new Set([
    "invocationId",
    "consumerId",
    "bindingId",
    "contractInstanceId",
    "artifactHash",
    "runtimeProfileHash",
    "methodName",
    "startedAt",
    "authoritySnapshotDigest",
    "generations",
  ]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown !== undefined) throw new TypeError(`Unknown invocation evidence field: ${unknown}.`);
  nonEmpty("invocationId", input.invocationId);
  nonEmpty("consumerId", input.consumerId);
  nonEmpty("bindingId", input.bindingId);
  nonEmpty("contractInstanceId", input.contractInstanceId);
  nonEmpty("artifactHash", input.artifactHash);
  nonEmpty("runtimeProfileHash", input.runtimeProfileHash);
  nonEmpty("methodName", input.methodName);
  nonEmpty("authoritySnapshotDigest", input.authoritySnapshotDigest);
  if (!Number.isSafeInteger(input.startedAt) || input.startedAt < 0) {
    throw new TypeError("startedAt must be a non-negative integer timestamp.");
  }
  const generationFields = Object.keys(input.generations).toSorted();
  if (generationFields.join("\0") !== [...GENERATION_FIELDS].toSorted().join("\0")) {
    throw new TypeError("Invocation evidence must contain exactly the closed generation fields.");
  }
  for (const name of GENERATION_FIELDS) {
    const generation = input.generations[name];
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new TypeError(`${name} generation must be a non-negative safe integer.`);
    }
  }
  const generations = Object.freeze({
    consumer: input.generations.consumer,
    binding: input.generations.binding,
    contractInstance: input.generations.contractInstance,
    environment: input.generations.environment,
    authority: input.generations.authority,
  });
  return Object.freeze({
    invocationId: input.invocationId,
    consumerId: input.consumerId,
    bindingId: input.bindingId,
    contractInstanceId: input.contractInstanceId,
    artifactHash: input.artifactHash,
    runtimeProfileHash: input.runtimeProfileHash,
    methodName: input.methodName,
    startedAt: input.startedAt,
    authoritySnapshotDigest: input.authoritySnapshotDigest,
    generations,
  });
}
