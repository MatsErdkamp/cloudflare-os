/** Test-facing in-memory persistence primitives for Contract host conformance suites. */
export { InMemoryArtifactStore } from "../host/artifact-store.js";
export { ContractSharedState } from "../host/shared-state-host.js";
export { createContractPolicy } from "../runtime/contract-session.js";
export { FakeSource } from "./fake-source.js";
export { TestContractHost } from "./test-contract-host.js";
export { assertContractCapabilitiesRetracted } from "./conformance.js";

/** Test-facing host and artifact shapes used to build fake Manager environments. */
export type { ArtifactStore } from "../host/artifact-store.js";
export type { SharedStateBackend } from "../host/shared-state-host.js";
export type { ContractOperationHost } from "../host/operation-host.js";
