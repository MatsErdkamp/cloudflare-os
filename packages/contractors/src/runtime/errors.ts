/** Stable compiler failure codes exposed to Contract authoring flows. */
export type ContractCompilationErrorCode =
  | "INVALID_INPUT"
  | "TYPE_CHECK_FAILED"
  | "MISSING_DEFAULT_EXPORT"
  | "MISSING_CONTRACT_BINDING"
  | "DEPENDENCY_NOT_ALLOWED"
  | "DEPENDENCY_VERSION_NOT_ALLOWED"
  | "BUNDLE_FAILED"
  | "BUNDLE_TOO_LARGE";

/** A structured failure produced before an artifact can be proposed. */
export class ContractCompilationError extends Error {
  override readonly name = "ContractCompilationError";

  constructor(
    readonly code: ContractCompilationErrorCode,
    message: string,
    readonly diagnostics: readonly string[] = [],
  ) {
    super(message);
  }
}

/** Signals that a retryable approval decision has not yet been made. */
export class ContractApprovalRequired extends Error {
  override readonly name = "ContractApprovalRequired";

  constructor(readonly operationId: string) {
    super(`Contract operation ${operationId} requires approval.`);
  }
}

/** Signals that Contract code reached an explicitly rejected approval gate. */
export class ContractApprovalRejected extends Error {
  override readonly name = "ContractApprovalRejected";

  constructor(readonly operationId: string) {
    super(`Contract operation ${operationId} was rejected.`);
  }
}
