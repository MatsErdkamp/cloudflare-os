import type {RpcStub, RpcTarget, WorkerEntrypoint} from "cloudflare:workers";

/** Exact immutable Binding Set selected for one standing Consumer environment. */
export interface ConsumerBindingSetReference {
  /** Authority-issued Binding Set ID. */
  readonly id: string;
  /** Immutable Binding Set version. */
  readonly version: number;
}

/** Capability-free metadata used to generate exact TypeScript environment declarations. */
export interface ConsumerBindingType {
  /** Published Binding name and generated environment property. */
  readonly name: string;
  /** Whether absence blocks the whole environment. */
  readonly required: boolean;
  /** Exact Artifact Approval cited by the published Resolution. */
  readonly artifactApprovalId: string;
  /** Active Artifact Approval epoch cited by the published Resolution. */
  readonly artifactApprovalEpoch: number;
  /** Exact approved public TypeScript declaration text. */
  readonly publicTypes: string;
}

/** One immutable, generation-tagged map of Contract capabilities. */
export interface ConsumerBindingEnvironment {
  /** Whole-environment generation; a mismatch invalidates every returned capability. */
  readonly generation: number;
  /** Exact Binding Set from which this map and its generated types were derived. */
  readonly bindingSet: ConsumerBindingSetReference;
  /** Stable metadata for declaration generation, ordered by Binding name. */
  readonly types: readonly ConsumerBindingType[];
  /** Named Contract capabilities; Sources and credentials are never included. */
  readonly bindings: Readonly<Record<string, RpcStub<RpcTarget>>>;
}

/** Bounded Development Session lifecycle and readiness view. */
export interface DevelopmentSessionStatus {
  /** Authority-issued leased Session ID. */
  readonly id: string;
  /** Current Consumer generation. */
  readonly consumerGeneration: number;
  /** Current lease generation. */
  readonly leaseGeneration: number;
  /** Absolute lease expiry in Unix milliseconds. */
  readonly expiresAt: number;
  /** Current whole-environment generation. */
  readonly environmentGeneration: number;
  /** Exact immutable Binding Set assigned by the Grant. */
  readonly bindingSet: ConsumerBindingSetReference;
  /** Whether every required canonical Binding is active. */
  readonly ready: boolean;
  /** Durable Session lifecycle. */
  readonly lifecycle: "active" | "disconnected" | "expired";
}

/** Idempotent request to create a lease from one exact reviewed Grant. */
export interface StartDevelopmentSession {
  /** Stable Authority Operation ID. */
  readonly operationId: string;
  /** Exact reviewed Development Session Grant. */
  readonly grantId: string;
  /** Grant generation the client resolved. */
  readonly expectedGrantGeneration: number;
  /** Exact immutable Binding Set the client confirmed. */
  readonly expectedBindingSet: ConsumerBindingSetReference;
}

/** Request to reconnect to the same still-live leased Consumer. */
export interface ResumeDevelopmentSession {
  /** Non-secret Authority-issued Session ID. */
  readonly sessionId: string;
  /** Consumer generation last observed by the client. */
  readonly expectedConsumerGeneration: number;
}

/** Generation-checked lease renewal request. */
export interface RenewDevelopmentLease {
  /** Stable Authority Operation ID. */
  readonly operationId: string;
  /** Consumer generation last observed by the client. */
  readonly expectedConsumerGeneration: number;
  /** Lease generation last observed by the client. */
  readonly expectedLeaseGeneration: number;
}

/** Generation-checked terminal disconnect request. */
export interface DisconnectDevelopmentSession {
  /** Stable Authority Operation ID. */
  readonly operationId: string;
  /** Consumer generation last observed by the client. */
  readonly expectedConsumerGeneration: number;
}

/** Immutable Development environment root; dispose it and all child stubs together. */
export interface DevelopmentEnvironment extends RpcTarget {
  /** Delivers the exact named capabilities and approved type declarations for this generation. */
  getBindings(): Promise<ConsumerBindingEnvironment>;
}

/** One live leased Development Session capability. */
export interface DevelopmentSession extends RpcTarget {
  /** Reads bounded lifecycle and readiness status. */
  getStatus(): Promise<DevelopmentSessionStatus>;
  /** Opens only the exact current ready environment generation. */
  openEnvironment(expectedEnvironmentGeneration: number): Promise<RpcStub<DevelopmentEnvironment>>;
  /** Renews the existing Consumer lease without selecting new authority. */
  renew(request: RenewDevelopmentLease): Promise<DevelopmentSessionStatus>;
  /** Terminally disconnects this leased Consumer. */
  disconnect(request: DisconnectDevelopmentSession): Promise<void>;
}

/** Build-permission capability for Development Session lifecycle operations. */
export interface DevelopmentApi extends RpcTarget {
  /** Starts or exactly replays a Session under one current reviewed Grant. */
  startSession(request: StartDevelopmentSession): Promise<RpcStub<DevelopmentSession>>;
  /** Resumes one still-live Session identity after transport loss. */
  resumeSession(request: ResumeDevelopmentSession): Promise<RpcStub<DevelopmentSession>>;
  /** Reads bounded status without opening its capability environment. */
  getSessionStatus(sessionId: string): Promise<DevelopmentSessionStatus>;
}

/** Caller-free negotiation request accepted by the private Workload entrypoint. */
export interface AttachWorkload {
  /** Protocol version supported by the calling deployment. */
  readonly protocol: "cloudflare-service-binding.v1";
  /** Optional audit correlation that carries no identity or authority. */
  readonly correlationId?: string;
}

/** Bounded status for one authenticated Workload attachment. */
export interface WorkloadStatus {
  /** Stable registered Workload ID. */
  readonly workloadId: string;
  /** Workload generation pinned by the attachment. */
  readonly workloadGeneration: number;
  /** Registration generation pinned by the attachment. */
  readonly registrationGeneration: number;
  /** Current whole-environment generation. */
  readonly environmentGeneration: number;
  /** Attachment deadline in Unix milliseconds. */
  readonly expiresAt: number;
  /** Whether every required canonical Binding is active. */
  readonly ready: boolean;
}

/** Immutable Workload environment root; generation changes invalidate it wholesale. */
export interface WorkloadEnvironment extends RpcTarget {
  /** Delivers exact named Contract capabilities and approved type declarations. */
  getBindings(): Promise<ConsumerBindingEnvironment>;
}

/** Transient authenticated attachment to one stable Workload Consumer. */
export interface WorkloadAttachment extends RpcTarget {
  /** Reads the exact generations and deadline pinned by this attachment. */
  getStatus(): Promise<WorkloadStatus>;
  /** Opens only the exact current ready environment generation. */
  openEnvironment(expectedEnvironmentGeneration: number): Promise<RpcStub<WorkloadEnvironment>>;
}

/** Private provider-authenticated Workload attachment seam. */
export interface WorkloadConnector extends WorkerEntrypoint {
  /** Authenticates platform evidence and opens no authority-management capability. */
  attach(request: AttachWorkload): Promise<RpcStub<WorkloadAttachment>>;
}
