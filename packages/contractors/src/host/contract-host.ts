import type {SharedContractState} from "../authoring/contract-context.js";
import type {ArtifactStore} from "./artifact-store.js";
import type {ContractOperationHost} from "./operation-host.js";

/** Host services required to install and execute Contracts without exposing deployment authority. */
export interface ContractHost<Source> {
  /** Immutable content-addressed artifact persistence. */
  readonly artifacts: ArtifactStore;
  /** Manager-owned explicit approval operation services. */
  readonly operations: ContractOperationHost<Source>;
  /** Returns a structured shared-state capability only for an explicitly configured namespace. */
  sharedState(namespace: string): SharedContractState;
}
