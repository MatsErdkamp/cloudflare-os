/** User-facing description of one manually approved Contract operation. */
export interface ContractApprovalDescription {
  readonly title: string;
  readonly description: string;
}

/** Stable, retryable approval gate authored by Contract code. */
export interface ContractApprovalRequirement extends ContractApprovalDescription {
  readonly key: string;
}

/** Explicit human-in-the-loop helpers available to Contract code. */
export interface ContractApprovalPolicy<Source> {
  manual<T>(
    description: ContractApprovalDescription,
    operation: (context: { readonly source: Source }) => Promise<T> | T,
  ): Promise<T>;

  require(description: ContractApprovalRequirement): Promise<void>;
}

/** Policy capabilities supplied by the Contract host. */
export interface ContractPolicy<Source> {
  readonly approval: ContractApprovalPolicy<Source>;
}
