/** Source approval behavior selected for one Contract-originated provider session. */
export type ContractSourceApprovalMode =
  | {readonly type: "preapproved"}
  | {readonly type: "manual"; readonly operationId: string};

