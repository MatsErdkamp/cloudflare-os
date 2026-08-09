import type {RpcTarget} from "cloudflare:workers";

/** Hard runtime-profile ceiling for one composed Contract call chain. */
export const CONTRACT_MAX_COMPOSITION_DEPTH = 8;

/** Runtime-profile bound for draining neutral observations after invalidation. */
export const CONTRACT_OBSERVER_DRAIN_TIMEOUT_MS = 1_000;

/** Closed host-produced identity installed into one Contract lifecycle endpoint. */
export interface ContractReachabilitySnapshot {
  readonly endpointId: string;
  readonly instanceId: string;
  readonly instanceGeneration: number;
  readonly artifactHash: string;
  readonly runtimeProfileHash: string;
  readonly reachabilityId: string;
  readonly reachabilityGeneration: number;
  readonly authoritySnapshotDigest: string;
  readonly compositionLineage: readonly string[];
  readonly chainDepth: number;
  readonly maxChainDepth: number;
}

/** Bounded authority-neutral event emitted by the Contractors lifecycle kernel. */
export type ContractLifecycleObservation = Readonly<{
  type:
    | "installed"
    | "cancelRequested"
    | "resultQuarantined"
    | "restorationCreated"
    | "restored"
    | "restorationRejected"
    | "unsupportedShapeRejected"
    | "invalidated";
  endpointId: string;
  reachabilityGeneration: number;
  restorationId?: string;
  shape?:
    | "readableStream"
    | "writableStream"
    | "transformStream"
    | "asyncIterator"
    | "abortSignal";
  outcome?: "quarantined";
  cleanupFailures?: number;
  cancelledInvocations?: number;
}>;

/** Receives bounded lifecycle observations without controlling authority. */
export interface ContractLifecycleObserver extends RpcTarget {
  observe(observation: ContractLifecycleObservation): void | Promise<void>;
}

/** Task-neutral cancellation capability for one composed upstream reachability. */
export interface ContractUpstreamCancellation extends RpcTarget {
  cancel(snapshot: ContractReachabilitySnapshot): void | Promise<void>;
}

/** Exact acknowledgement that one old reachability generation is release-closed. */
export interface ContractInvalidationAcknowledgement {
  readonly endpointId: string;
  readonly reachabilityGeneration: number;
  readonly invalidated: true;
  readonly cancelledInvocations: number;
  readonly cleanupFailures: number;
}

/** Capability-free restoration envelope bound to one exact lifecycle snapshot. */
export interface ContractRestorationRecord<Params = unknown> {
  readonly restorationId: string;
  readonly endpointId: string;
  readonly instanceId: string;
  readonly instanceGeneration: number;
  readonly artifactHash: string;
  readonly runtimeProfileHash: string;
  readonly reachabilityId: string;
  readonly reachabilityGeneration: number;
  readonly authoritySnapshotDigest: string;
  readonly params: Params;
}

/** Capability-free reference returned to a host without private restoration parameters. */
export type ContractRestorationReference = Omit<ContractRestorationRecord, "params">;

/** Closed session material accepted by the current Contract lifecycle endpoint. */
export interface ContractLifecycleSession {
  readonly source: RpcTarget;
  readonly approval: RpcTarget;
  readonly restorer: RpcTarget;
  readonly sharedState?: RpcTarget;
  readonly reachability: ContractReachabilitySnapshot;
  readonly invocation: import("./contract-invocation.js").ContractInvocationEvidence;
  readonly contract: Readonly<{id: string; artifactHash: string}>;
}

/** Small host-facing interface implemented by every current Contract lifecycle endpoint. */
export interface ContractLifecycleEndpoint {
  install(
    snapshot: ContractReachabilitySnapshot,
    observer?: ContractLifecycleObserver,
    upstreamCancellation?: ContractUpstreamCancellation,
  ): Promise<Readonly<{endpointId: string; reachabilityGeneration: number}>>;
  startSession(session: ContractLifecycleSession): Promise<unknown>;
  restoreSession(
    session: ContractLifecycleSession,
    reference: ContractRestorationReference,
  ): Promise<unknown>;
  beginInvalidation(reachabilityGeneration: number): Promise<unknown>;
  invalidate(reachabilityGeneration: number): Promise<ContractInvalidationAcknowledgement>;
}

/** Stable fail-closed error codes emitted by the generic lifecycle kernel. */
export type ContractLifecycleErrorCode =
  | "CHAIN_DEPTH_EXCEEDED"
  | "INVALID_LIFECYCLE_INPUT";

/** Generic lifecycle failure without standing or task policy semantics. */
export class ContractLifecycleError extends Error {
  constructor(readonly code: ContractLifecycleErrorCode, message: string) {
    super(message);
    this.name = "ContractLifecycleError";
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (value.length === 0) {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", `${name} must not be empty.`);
  }
}

function assertGeneration(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContractLifecycleError(
      "INVALID_LIFECYCLE_INPUT",
      `${name} must be a non-negative safe integer.`,
    );
  }
}

function unsupportedStreamShape(value: unknown): ContractLifecycleObservation["shape"] | undefined {
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    return "readableStream";
  }
  if (typeof WritableStream !== "undefined" && value instanceof WritableStream) {
    return "writableStream";
  }
  if (typeof TransformStream !== "undefined" && value instanceof TransformStream) {
    return "transformStream";
  }
  return undefined;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function cloneCapabilityFree(
  value: unknown,
  depth = 0,
  count = { value: 0 },
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (depth > 32 || ++count.value > 4_096) {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Restoration params exceed limits.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return value;
  if (typeof value !== "object") {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Restoration params contain authority.");
  }
  if (unsupportedStreamShape(value) || isAbortSignal(value) || Symbol.asyncIterator in value) {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Restoration params contain authority.");
  }
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const child of value) clone.push(cloneCapabilityFree(child, depth + 1, count, seen));
    return Object.freeze(clone);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Restoration params must be plain data.");
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Restoration params contain symbols.");
  }
  const clone: Record<string, unknown> = {};
  seen.set(value, clone);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor)) {
      throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Restoration params contain accessors.");
    }
    clone[key] = cloneCapabilityFree(descriptor.value, depth + 1, count, seen);
  }
  return Object.freeze(clone);
}

/** Validates, copies, and freezes one task-neutral host reachability snapshot. */
export function validateContractReachabilitySnapshot(
  input: ContractReachabilitySnapshot,
): ContractReachabilitySnapshot {
  const allowed = [
    "endpointId", "instanceId", "instanceGeneration", "artifactHash",
    "runtimeProfileHash", "reachabilityId", "reachabilityGeneration",
    "authoritySnapshotDigest", "compositionLineage", "chainDepth", "maxChainDepth",
  ];
  if (Object.keys(input).toSorted().join("\0") !== allowed.toSorted().join("\0")) {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Reachability snapshot is not closed.");
  }
  for (const [name, value] of [
    ["endpointId", input.endpointId],
    ["instanceId", input.instanceId],
    ["artifactHash", input.artifactHash],
    ["runtimeProfileHash", input.runtimeProfileHash],
    ["reachabilityId", input.reachabilityId],
    ["authoritySnapshotDigest", input.authoritySnapshotDigest],
  ] as const) assertNonEmpty(name, value);
  assertGeneration("instanceGeneration", input.instanceGeneration);
  assertGeneration("reachabilityGeneration", input.reachabilityGeneration);
  assertGeneration("chainDepth", input.chainDepth);
  assertGeneration("maxChainDepth", input.maxChainDepth);
  if (input.maxChainDepth > CONTRACT_MAX_COMPOSITION_DEPTH || input.chainDepth > input.maxChainDepth) {
    throw new ContractLifecycleError("CHAIN_DEPTH_EXCEEDED", "Reachability depth exceeds runtime profile.");
  }
  if (input.compositionLineage.length !== input.chainDepth + 1 ||
      input.compositionLineage.at(-1) !== input.endpointId ||
      new Set(input.compositionLineage).size !== input.compositionLineage.length) {
    throw new ContractLifecycleError("INVALID_LIFECYCLE_INPUT", "Invalid composition lineage.");
  }
  return Object.freeze({ ...input, compositionLineage: Object.freeze([...input.compositionLineage]) });
}

/** Creates a capability-free restoration record bound to one exact snapshot. */
export function createContractRestorationRecord<Params>(
  snapshot: ContractReachabilitySnapshot,
  restorationId: string,
  params: Params,
): ContractRestorationRecord<Params> {
  const current = validateContractReachabilitySnapshot(snapshot);
  assertNonEmpty("restorationId", restorationId);
  const cloned = cloneCapabilityFree(params) as Params;
  return Object.freeze({
    restorationId,
    endpointId: current.endpointId,
    instanceId: current.instanceId,
    instanceGeneration: current.instanceGeneration,
    artifactHash: current.artifactHash,
    runtimeProfileHash: current.runtimeProfileHash,
    reachabilityId: current.reachabilityId,
    reachabilityGeneration: current.reachabilityGeneration,
    authoritySnapshotDigest: current.authoritySnapshotDigest,
    params: cloned,
  });
}
