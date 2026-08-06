import type {
  ContractActionAttribution,
  ContractCallContext,
} from "../runtime/contract-call.js";

/** Derives provider audit attribution from the live Contract call without inventing an identity. */
export function contractActionAttribution<WorkpieceId>(
  call: ContractCallContext<WorkpieceId>,
  operationId?: string,
): ContractActionAttribution<WorkpieceId> {
  return {
    contractId: call.contractId,
    artifactHash: call.artifactHash,
    contractCallId: call.callId,
    ...(call.methodName ? {contractMethod: call.methodName} : {}),
    ...(operationId ? {contractOperationId: operationId} : {}),
  };
}
