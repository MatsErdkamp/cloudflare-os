/** Stable version of the additive direct-approval Contract authoring interface. */
export const CONTRACT_AUTHORING_ABI_VERSION = "8";

/** Exact ambient declaration hashed into every v8 Contract Artifact. */
export const CONTRACT_AUTHORING_ABI_V8 = `
  declare module "@gadgets/contractors/authoring" {
    import type { RpcTarget } from "cloudflare:workers";
    export interface ContractApprovalDescription {
      readonly title: string;
      readonly description: string;
    }
    export interface ContractApprovalRequirement extends ContractApprovalDescription {
      readonly key: string;
    }
    export interface ContractApproval<Source> {
      manual<T>(description: ContractApprovalDescription,
        operation: (context: {readonly source: Source}) => Promise<T> | T): Promise<T>;
      require(description: ContractApprovalRequirement): Promise<void>;
    }
    export interface SharedContractState {
      get<T>(key: string): Promise<T | undefined>;
      put<T>(key: string, value: T): Promise<void>;
      delete(key: string): Promise<void>;
    }
    export interface ContractInvocationGenerations {
      readonly consumer: number;
      readonly binding: number;
      readonly contractInstance: number;
      readonly environment: number;
      readonly authority: number;
    }
    export interface ContractInvocationEvidence {
      readonly schemaVersion: 1;
      readonly invocationId: string;
      readonly consumerId: string;
      readonly bindingId: string;
      readonly contractInstanceId: string;
      readonly artifactHash: string;
      readonly runtimeProfileHash: string;
      readonly methodName: string;
      readonly startedAt: number;
      readonly authoritySnapshotDigest: string;
      readonly generations: ContractInvocationGenerations;
    }
    export interface ContractContext<Source> {
      readonly source: Source;
      readonly approval: ContractApproval<Source>;
      readonly storage: DurableObjectStorage;
      readonly sharedState?: SharedContractState;
      readonly invocation: ContractInvocationEvidence;
      readonly contract: { readonly id: string; readonly artifactHash: string };
      restore<T extends RpcTarget>(params: unknown): import("cloudflare:workers").RpcStub<T>;
    }
    export type ContractFactory<Source, Binding extends RpcTarget> =
      (context: ContractContext<Source>) => Binding | Promise<Binding>;
    export type ContractCapabilityRestorer<Source> =
      (context: ContractContext<Source>, params: unknown) => RpcTarget | Promise<RpcTarget>;
    export function defineContract<Source, Binding extends RpcTarget>(
      factory: ContractFactory<Source, Binding>,
    ): ContractFactory<Source, Binding>;
  }
`;
