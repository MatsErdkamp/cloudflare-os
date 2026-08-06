import type { ContractCaller } from "../authoring/contract-context.js";
import type { ContractPolicy } from "../authoring/contract-policy.js";
import type { ContractOperationHost } from "../host/operation-host.js";
import { ContractApprovalRejected, ContractApprovalRequired } from "./errors.js";

/** Inputs used to mint policy capabilities for one live Contract call. */
export interface CreateContractPolicyInput<Source> {
  readonly source: Source;
  readonly contract: {
    readonly id: string;
    readonly artifactHash: string;
  };
  readonly caller: ContractCaller;
  readonly operationHost: ContractOperationHost<Source>;
}

/** Creates optional HITL helpers; it does not constrain ordinary Source use. */
export function createContractPolicy<Source>(
  input: CreateContractPolicyInput<Source>,
): ContractPolicy<Source> {
  const attribution = {
    contractId: input.contract.id,
    artifactHash: input.contract.artifactHash,
    caller: input.caller,
  };

  return {
    approval: {
      async manual(description, operation) {
        const manual = await input.operationHost.beginManual(description, attribution);
        try {
          const result = await operation({ source: manual.source });
          await input.operationHost.finishManual(manual.operationId);
          return result;
        } catch (error) {
          await input.operationHost.abortManual(manual.operationId, error);
          throw error;
        }
      },

      async require(description) {
        const existing = await input.operationHost.findRequirement(
          input.contract.id,
          description.key,
        );
        if (existing?.state === "approved") return;
        if (existing?.state === "rejected") {
          throw new ContractApprovalRejected(existing.operationId);
        }
        if (existing) throw new ContractApprovalRequired(existing.operationId);

        const operationId = await input.operationHost.createRequirement(description, attribution);
        throw new ContractApprovalRequired(operationId);
      },
    },
  };
}
