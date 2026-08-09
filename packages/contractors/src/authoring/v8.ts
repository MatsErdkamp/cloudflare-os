import type { RpcStub, RpcTarget } from "cloudflare:workers";

import type {
  ContractApprovalDescription,
  ContractApprovalRequirement,
} from "./contract-policy.js";
import type { ContractInvocationEvidence } from "../runtime/contract-invocation.js";

/** Direct approval capability supplied to v8 Contract code. */
export interface ContractApproval<Source> {
  /** Runs one operation after the host releases its already-present Source authority. */
  manual<T>(
    description: ContractApprovalDescription,
    operation: (context: { readonly source: Source }) => Promise<T> | T,
  ): Promise<T>;

  /** Requires one stable approval decision without exposing its control-plane record. */
  require(description: ContractApprovalRequirement): Promise<void>;
}

/** Narrow structured-data store shared only when an installation explicitly opts in. */
export interface SharedContractState {
  /** Reads one structured value. */
  get<T>(key: string): Promise<T | undefined>;
  /** Writes one structured value. */
  put<T>(key: string, value: T): Promise<void>;
  /** Deletes one structured value. */
  delete(key: string): Promise<void>;
}

/** Capabilities supplied to v8 Contract code for one instance. */
export interface ContractContext<Source> {
  /** Exact attenuated Upstream Authority for this Contract Instance. */
  readonly source: Source;
  /** Direct release interface for authority already present in this Contract. */
  readonly approval: ContractApproval<Source>;
  /** Private durable storage for this Contract Instance. */
  readonly storage: DurableObjectStorage;
  /** Optional explicitly selected shared-state namespace. */
  readonly sharedState?: SharedContractState;
  /** Closed host-produced evidence for this exact invocation generation snapshot. */
  readonly invocation: ContractInvocationEvidence;
  /** Immutable local Contract identity with no control-plane record access. */
  readonly contract: {
    readonly id: string;
    readonly artifactHash: string;
  };

  /** Restores a Contract-owned capability from bounded immutable parameters. */
  restore<T extends RpcTarget>(params: unknown): RpcStub<T>;
}

/** Creates the public root capability for one v8 Contract session. */
export type ContractFactory<Source, Binding extends RpcTarget> = (
  context: ContractContext<Source>,
) => Binding | Promise<Binding>;

/** Optional v8 export used to rebuild persistent Contract-owned capabilities. */
export type ContractCapabilityRestorer<Source> = (
  context: ContractContext<Source>,
  params: unknown,
) => RpcTarget | Promise<RpcTarget>;

/** Declares a v8 Contract factory without adding or interpreting policy. */
export function defineContract<Source, Binding extends RpcTarget>(
  factory: ContractFactory<Source, Binding>,
): ContractFactory<Source, Binding> {
  return factory;
}
