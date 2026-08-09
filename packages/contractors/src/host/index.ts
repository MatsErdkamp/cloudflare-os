export { InMemoryArtifactStore } from "./artifact-store.js";
export type { ArtifactStore } from "./artifact-store.js";
export type { ContractHost } from "./contract-host.js";
export type { ContractOperationHost } from "./operation-host.js";
export { assertContractStructuredData, ContractSharedState } from "./shared-state-host.js";
export type { SharedStateBackend } from "./shared-state-host.js";
/** Mints immutable generation-aware evidence at the Contract host seam. */
export { createContractInvocationEvidence } from "./invocation-evidence.js";
export type {
  ContractInvocationEvidence,
  ContractInvocationEvidenceInput,
  ContractInvocationGenerations,
} from "../runtime/contract-invocation.js";
/** Validates and freezes one host-produced lifecycle snapshot. */
export { validateContractReachabilitySnapshot } from "../runtime/capability-lifecycle.js";
/** Seals capability-free restoration parameters to one exact lifecycle snapshot. */
export { createContractRestorationRecord } from "../runtime/capability-lifecycle.js";
