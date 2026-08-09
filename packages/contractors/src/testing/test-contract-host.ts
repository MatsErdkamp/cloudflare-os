import type {SharedContractState} from "../authoring/contract-authoring.js";
import {InMemoryArtifactStore} from "../host/artifact-store.js";
import type {ContractHost} from "../host/contract-host.js";
import type {ContractOperationHost} from "../host/operation-host.js";
import {ContractSharedState} from "../host/shared-state-host.js";

/** Minimal in-memory Contract host for package consumers' unit tests. */
export class TestContractHost<Source> implements ContractHost<Source> {
  readonly artifacts = new InMemoryArtifactStore();
  readonly #state = new Map<string, unknown>();

  constructor(readonly operations: ContractOperationHost<Source>) {}

  sharedState(namespace: string): SharedContractState {
    return new ContractSharedState(namespace, {
      get: async (key) => this.#state.get(key),
      put: async (key, value) => { this.#state.set(key, value); },
      delete: async (key) => { this.#state.delete(key); },
    });
  }
}
