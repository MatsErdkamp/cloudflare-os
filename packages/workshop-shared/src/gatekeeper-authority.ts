import type {DurableObject, RpcTarget, RpcStub} from "cloudflare:workers";

/** Stable provider-side identity for one task-neutral Gatekeeper Source. */
export type ProviderAuthorityIdentity = Readonly<{
  /** Stable identifier for the provider implementation. */
  providerId: string;
  /** Opaque provider account identity; never a credential or physical storage prefix. */
  accountId: string;
  /** Stable identity of the Source within that account. */
  sourceId: string;
  /** Monotonic generation of the Source identity and provider connection. */
  sourceGeneration: number;
}>;

/** Exact Workspace-owned Contract Instance reference used only as a provider backing key. */
export type ProviderContractInstanceReference = Readonly<{
  /** Opaque canonical Contract Instance identity. */
  id: string;
  /** Exact Contract Instance generation requesting provider backing. */
  generation: number;
}>;

/** Bounded provider-native authority reported without Workspace or Agent Task policy. */
export type ProviderNativeAuthorityScope = Readonly<{
  /** Provider-native resource selectors covered by the Source. */
  resources: readonly string[];
  /** Provider-native operations available through the Source. */
  operations: readonly string[];
  /** Provider-native recipient selectors, when applicable. */
  recipients: readonly string[];
  /** Provider-native egress destinations, when applicable. */
  egress: readonly string[];
}>;

/** Task-neutral provider health and authority description. */
export type ProviderAuthorityDescription = Readonly<{
  /** Exact provider identity and Source generation. */
  identity: ProviderAuthorityIdentity;
  /** Current provider connectivity or account state. */
  health: "healthy" | "degraded" | "revoked";
  /** Maximum provider-native scope behind this Source. */
  providerNativeScope: ProviderNativeAuthorityScope;
  /** Finest provider-native unit that can be revoked independently. */
  providerNativeRevocationGranularity: "deployment-resource" | "account" | "source";
  /** Finest unit the Gatekeeper enforcement layer can invalidate independently. */
  localEnforcementRevocationGranularity: "account" | "source-generation" |
    "contract-instance-backing";
}>;

/** One idempotent provider lifecycle request from Workspace Authority. */
export type ProviderAuthorityLifecycleRequest = Readonly<{
  /** Stable Authority Operation key reused across retries of the same exact request. */
  operationId: string;
  /** Provider identity and Source generation the caller expects. */
  expectedProvider: ProviderAuthorityIdentity;
  /** Exact canonical Contract Instance whose backing is being managed. */
  contractInstance: ProviderContractInstanceReference;
  /** Capability generation expected before this transition, or zero for first preparation. */
  expectedCapabilityGeneration: number;
}>;

/** Durable provider-side state for one Contract Instance backing or grant. */
export type ProviderAuthorityLifecycleResult = Readonly<{
  /** Exact provider identity validated for the operation. */
  provider: ProviderAuthorityIdentity;
  /** Exact Contract Instance owning this backing or grant. */
  contractInstance: ProviderContractInstanceReference;
  /** Opaque backing reference that never reveals a physical provider locator. */
  backingReference: string;
  /** Current generation of this provider capability. */
  capabilityGeneration: number;
  /** Current provider-side lifecycle state. */
  state: "prepared" | "active" | "inactive" | "destroyed";
  /** Whether provider cleanup has completed for a destroyed backing. */
  cleanup: "not-required" | "pending" | "complete";
}>;

/** Exact authority snapshot required to open a generation-bound Source session. */
export type ProviderAuthoritySessionRequest = Readonly<{
  /** Provider identity and Source generation the caller expects. */
  expectedProvider: ProviderAuthorityIdentity;
  /** Exact Contract Instance whose active backing the session will use. */
  contractInstance: ProviderContractInstanceReference;
  /** Exact active provider capability generation. */
  expectedCapabilityGeneration: number;
}>;

/** Provider-scoped evidence for one completed observation. */
export type ProviderObservationEvidence = Readonly<{
  /** Stable provider observation identity. */
  observationId: string;
  /** Exact provider identity and Source generation used. */
  provider: ProviderAuthorityIdentity;
  /** Exact Contract Instance backing and capability generation used. */
  contractInstance: ProviderContractInstanceReference;
  /** Provider capability generation used by the observation. */
  capabilityGeneration: number;
  /** Public provider operation name. */
  operation: string;
  /** Opaque logical provider resource identifier, never a physical bucket prefix. */
  resource: string;
  /** Scope requested from the provider. */
  requestedScope: ProviderNativeAuthorityScope;
  /** Scope resolved after provider-side selection and constraints. */
  resolvedScope: ProviderNativeAuthorityScope;
  /** Scope represented by the returned result. */
  returnedScope: ProviderNativeAuthorityScope;
  /** Bounded data classification assigned by the provider adapter. */
  classification: "metadata" | "content" | "listing";
  /** Bounded provenance for the returned data. */
  provenance: "provider-live" | "provider-staged" | "provider-missing";
  /** Returned byte count when known, otherwise zero. */
  bytes: number;
}>;

/** Provider-scoped evidence for one staged external action. */
export type ProviderActionEvidence = Readonly<{
  /** Stable provider action identity. */
  actionId: string;
  /** Exact provider identity and Source generation used. */
  provider: ProviderAuthorityIdentity;
  /** Exact Contract Instance backing and capability generation used. */
  contractInstance: ProviderContractInstanceReference;
  /** Provider capability generation used to stage the action. */
  capabilityGeneration: number;
  /** Public provider operation name. */
  operation: string;
  /** Opaque logical provider resource identifier. */
  resource: string;
  /** Scope requested for the action. */
  requestedScope: ProviderNativeAuthorityScope;
  /** Scope resolved by the provider adapter. */
  resolvedScope: ProviderNativeAuthorityScope;
  /** Staged payload byte count when applicable, otherwise zero. */
  bytes: number;
}>;

/** Idempotent host callback for one previously staged provider action. */
export type ProviderActionCallbackRequest = Readonly<{
  /** Stable Authority Operation key reused across retries of the same callback. */
  operationId: string;
  /** Exact provider identity and Source generation expected by the host. */
  expectedProvider: ProviderAuthorityIdentity;
  /** Exact Contract Instance owning the staged action. */
  contractInstance: ProviderContractInstanceReference;
  /** Exact provider capability generation that staged the action. */
  expectedCapabilityGeneration: number;
  /** Opaque action identity returned in Provider Action Evidence. */
  actionId: string;
}>;

/** Narrow host capability that authorizes provider observations before result release. */
export interface ProviderObservationEnforcer extends RpcTarget {
  /** Authorizes one task-neutral provider observation and records its evidence. */
  authorizeProviderObservation(evidence: ProviderObservationEvidence): Promise<void>;
}

/** Narrow host capability that records provider actions without observation authority. */
export interface ProviderActionStager extends RpcTarget {
  /** Registers one staged provider action for later approval or rejection. */
  stageProviderAction(evidence: ProviderActionEvidence): Promise<void>;
}

/** Current task-neutral Gatekeeper authority protocol implemented by conforming Sources. */
export interface GatekeeperAuthorityProvider<Session extends RpcTarget> extends DurableObject {
  /** Returns stable provider identity, health, scope, and revocation granularity. */
  describeProviderAuthority(): Promise<ProviderAuthorityDescription>;
  /** Idempotently prepares provider backing for one exact Contract Instance. */
  prepareProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult>;
  /** Idempotently activates previously prepared or inactive provider backing. */
  activateProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult>;
  /** Immediately invalidates one active provider capability generation. */
  deactivateProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult>;
  /** Invalidates and idempotently destroys one provider backing or grant. */
  destroyProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult>;
  /** Idempotently applies one staged action after revalidating its authority generation. */
  applyProviderAction(request: ProviderActionCallbackRequest): Promise<void>;
  /** Idempotently rejects one staged action after revalidating its authority generation. */
  rejectProviderAction(request: ProviderActionCallbackRequest): Promise<void>;
  /** Opens a generation-bound Source session with separate observation and action hosts. */
  startProviderAuthoritySession(
    request: ProviderAuthoritySessionRequest,
    observationEnforcer: RpcStub<ProviderObservationEnforcer>,
    actionStager: RpcStub<ProviderActionStager>,
  ): Promise<Session>;
}
