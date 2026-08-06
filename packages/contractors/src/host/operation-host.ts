import type {
  ContractApprovalDescription,
  ContractApprovalRequirement,
} from "../authoring/contract-policy.js";
import type {
  ContractOperationAttribution,
  ContractOperationDecision,
} from "../runtime/contract-operation.js";

/** Manager-owned operation services used by the isolated Contract policy capability. */
export interface ContractOperationHost<Source> {
  beginManual(
    description: ContractApprovalDescription,
    attribution: ContractOperationAttribution,
  ): Promise<{readonly operationId: string; readonly source: Source}>;

  finishManual(operationId: string): Promise<void>;
  abortManual(operationId: string, cause: unknown): Promise<void>;

  findRequirement(
    contractId: string,
    approvalKey: string,
  ): Promise<ContractOperationDecision | undefined>;

  createRequirement(
    description: ContractApprovalRequirement,
    attribution: ContractOperationAttribution,
  ): Promise<string>;
}
