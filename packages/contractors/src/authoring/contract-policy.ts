/** User-facing description of one manually approved Contract operation. */
export interface ContractApprovalDescription {
  readonly title: string;
  readonly description: string;
}

/** Stable, retryable approval gate authored by Contract code. */
export interface ContractApprovalRequirement extends ContractApprovalDescription {
  readonly key: string;
}
