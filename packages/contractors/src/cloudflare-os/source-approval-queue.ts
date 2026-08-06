import type {ContractCallContext} from "../runtime/contract-call.js";
import type {ContractSourceApprovalMode} from "./source-session.js";

/** Host callbacks needed to adapt a provider approval queue to Contract possession semantics. */
export interface ContractSourceApprovalHost<Observation, Action> {
  authorizeObservation(call: ContractCallContext, description: Observation): Promise<void>;
  submitAction(
    call: ContractCallContext,
    mode: ContractSourceApprovalMode,
    action: number,
    description: Action,
  ): Promise<void>;
}

/** Host-neutral observation/action portion of a Contract-aware Source approval queue. */
export class ContractSourceApprovalQueue<Observation, Action> {
  constructor(
    readonly host: ContractSourceApprovalHost<Observation, Action>,
    readonly call: ContractCallContext,
    readonly mode: ContractSourceApprovalMode,
  ) {}

  authorizeObservation(description: Observation): Promise<void> {
    return this.host.authorizeObservation(this.call, description);
  }

  submitAction(action: number, description: Action): Promise<void> {
    return this.host.submitAction(this.call, this.mode, action, description);
  }
}
