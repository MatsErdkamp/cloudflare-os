import {CONTRACT_AUTHORING_ABI} from "../authoring/abi.js";
import {
  CONTRACT_HARNESS,
  CONTRACT_MAX_COMPOSITION_DEPTH,
  CONTRACT_OBSERVER_DRAIN_TIMEOUT_MS,
} from "../runtime/contract-harness.js";
import type {ContractArtifact, ContractRuntimeProfileIdentity} from "./contract-artifact.js";
import {
  canonicalContractJson,
  hashArtifact,
  hashContractText,
  hashContractValue,
} from "./hash-artifact.js";

/** Builds the sole current content-addressed Contract runtime profile. */
export async function createContractRuntimeProfile(
  compatibilityDate: string,
  compatibilityFlags: readonly string[],
): Promise<ContractRuntimeProfileIdentity> {
  const runtimeHarnessHash = await hashContractText(CONTRACT_HARNESS);
  return Object.freeze({
    profile: "cloudflare-workers-dynamic",
    compatibilityDate,
    compatibilityFlags: Object.freeze([...compatibilityFlags].toSorted()),
    globalOutbound: "none",
    runtimeHarnessHash,
    runtimeModuleSetHash: await hashContractValue({"contract-harness.js": runtimeHarnessHash}),
    authoringAbi: Object.freeze({declarationHash: await hashContractText(CONTRACT_AUTHORING_ABI)}),
    lifecycle: Object.freeze({
      maxCompositionDepth: CONTRACT_MAX_COMPOSITION_DEPTH,
      observerDrainTimeoutMs: CONTRACT_OBSERVER_DRAIN_TIMEOUT_MS,
      rawReadableStreams: "unsupported",
      rawWritableStreams: "unsupported",
      rawTransformStreams: "unsupported",
      rawAsyncIterators: "unsupported",
      rawAbortSignals: "unsupported",
      upstreamCancellation: "mediated",
    }),
  });
}

/** Verifies that an Artifact names exactly the current runtime and its complete identity. */
export async function assertCurrentContractArtifact(artifact: ContractArtifact): Promise<void> {
  const expectedProfile = await createContractRuntimeProfile(
    artifact.runtimeProfile.compatibilityDate,
    artifact.runtimeProfile.compatibilityFlags,
  );
  if (canonicalContractJson(artifact.runtimeProfile) !== canonicalContractJson(expectedProfile) ||
      artifact.runtimeProfileHash !== await hashContractValue(expectedProfile)) {
    throw new Error("Contract artifact does not use the current runtime profile.");
  }
  const {hash, ...authority} = artifact;
  if (hash !== await hashArtifact(authority)) {
    throw new Error(`Contract artifact content does not match ${hash}.`);
  }
}
