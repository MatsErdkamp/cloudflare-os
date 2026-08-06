import type { RpcStub, RpcTarget } from "cloudflare:workers";

import type { ContractPolicy } from "./contract-policy.js";

/** Existing Cloudflare OS caller metadata, kept extensible to avoid a second identity taxonomy. */
export type ContractCaller = Readonly<Record<string, unknown>>;

/** Narrow structured-data store shared only when an installation explicitly opts in. */
export interface SharedContractState {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Capabilities supplied to approved Contract code for one instance. */
export interface ContractContext<Source> {
  readonly source: Source;
  readonly policy: ContractPolicy<Source>;
  readonly storage: DurableObjectStorage;
  readonly sharedState?: SharedContractState;
  readonly caller: ContractCaller;
  readonly contract: {
    readonly id: string;
    readonly artifactHash: string;
  };

  restore<T extends RpcTarget>(params: unknown): RpcStub<T>;
}
