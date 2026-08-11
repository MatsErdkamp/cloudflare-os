import type {TaskAuthorityCorrelation} from "./records";

/** Normalized authority compared by the Trust Ratchet. */
export interface RatchetAuthorityEnvelope {
  readonly provider: string;
  readonly resourceIdentity: string;
  readonly upstreamAuthorityIdentity: string;
  readonly artifactApprovalId: string;
  readonly artifactApprovalEpoch: number;
  readonly operations: readonly string[];
  readonly recipients: readonly string[];
  readonly egress: readonly string[];
  readonly releaseClasses: readonly string[];
  readonly sharing: string;
  readonly enforcementProfile: string;
  readonly maximumExpiresAt: number;
}

/** Exact Binding authority participating in one Task Environment generation. */
export interface RatchetBindingAuthority {
  readonly name: string;
  readonly requirementId: string;
  readonly bindingId: string;
  readonly bindingGeneration: number;
  readonly contractInstanceId: string;
  readonly contractInstanceGeneration: number;
  readonly authority: RatchetAuthorityEnvelope;
}

/** Current immutable Task Environment view needed by a transition. */
export interface RatchetEnvironmentSnapshot {
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly taskActive: boolean;
  readonly generation: number;
  readonly ratchetVersion: number;
  readonly leaseExpiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly correlation: TaskAuthorityCorrelation;
  readonly bindings: readonly RatchetBindingAuthority[];
  readonly permanentlyRemoved: readonly string[];
}

/** One requested binding outcome in the next generation. */
export type RatchetBindingChange =
  | Readonly<{type: "retain"; bindingId: string}>
  | Readonly<{type: "retract"; bindingId: string}>
  | Readonly<{
      type: "replace";
      bindingId: string;
      replacement: RatchetBindingAuthority;
    }>;

/** Durable, resumable transition intent. */
export interface TrustRatchetTransition {
  readonly id: string;
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly absoluteExpiresAt: number;
  readonly correlation: TaskAuthorityCorrelation;
  readonly parentEnvironmentGeneration: number;
  readonly parentRatchetVersion: number;
  readonly nextEnvironmentGeneration: number;
  readonly nextRatchetVersion: number;
  readonly nextExpiresAt: number;
  readonly changes: readonly RatchetBindingChange[];
  readonly nextBindings: readonly RatchetBindingAuthority[];
  readonly permanentlyRemoved: readonly string[];
}

/** Exact endpoint acknowledgement for the next or invalidated generation. */
export interface RatchetEndpointAcknowledgement {
  readonly transitionId: string;
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly environmentGeneration: number;
  readonly ratchetVersion: number;
  readonly bindingId: string;
  readonly bindingGeneration: number;
  readonly contractInstanceId: string;
  readonly contractInstanceGeneration: number;
  readonly state: "prepared" | "invalidated";
}

/** Exact acknowledgement that the complete environment is published. */
export interface RatchetPublicationAcknowledgement {
  readonly transitionId: string;
  readonly taskId: string;
  readonly taskGeneration: number;
  readonly leaseGeneration: number;
  readonly environmentGeneration: number;
  readonly ratchetVersion: number;
  readonly bindings: readonly Readonly<{
    bindingId: string;
    bindingGeneration: number;
    contractInstanceId: string;
    contractInstanceGeneration: number;
  }>[];
}

/** Host seam keeping durable state and external enforcement work outside the policy module. */
export interface TrustRatchetHost {
  /** Reads a durable transition and its committed outcome for crash recovery. */
  readTransition(id: string): Readonly<{
    transition: TrustRatchetTransition;
    state: "pending" | "committed";
    environment?: RatchetEnvironmentSnapshot;
  }> | undefined;
  /** Re-reads the current canonical environment. */
  readCurrent(taskId: string): RatchetEnvironmentSnapshot | undefined;
  /** Holds all protected results before any replacement work begins. */
  holdProtectedResults(transition: TrustRatchetTransition): Promise<void>;
  /** Persists or exactly replays the immutable transition intent. */
  persistTransition(transition: TrustRatchetTransition): Promise<void>;
  /** Idempotently prepares one retained or fresh endpoint for the next generation. */
  prepareBinding(
    transition: TrustRatchetTransition,
    replacement: RatchetBindingAuthority,
  ): Promise<RatchetEndpointAcknowledgement>;
  /** Idempotently invalidates one predecessor endpoint and all derived reachability. */
  invalidatePredecessor(
    transition: TrustRatchetTransition,
    predecessor: RatchetBindingAuthority,
  ): Promise<RatchetEndpointAcknowledgement>;
  /** Atomically commits the next canonical environment after every acknowledgement. */
  commitTransition(
    transition: TrustRatchetTransition,
    prepared: readonly RatchetEndpointAcknowledgement[],
    invalidated: readonly RatchetEndpointAcknowledgement[],
  ): Promise<RatchetEnvironmentSnapshot>;
  /** Publishes and acknowledges the already committed complete environment. */
  publishEnvironment(
    transition: TrustRatchetTransition,
    environment: RatchetEnvironmentSnapshot,
  ): Promise<RatchetPublicationAcknowledgement>;
}

function subset(next: readonly string[], current: readonly string[]): boolean {
  const allowed = new Set(current);
  return next.every(value => allowed.has(value));
}

function fingerprint(binding: RatchetBindingAuthority): string {
  return JSON.stringify({
    requirementId: binding.requirementId,
    provider: binding.authority.provider,
    resourceIdentity: binding.authority.resourceIdentity,
    upstreamAuthorityIdentity: binding.authority.upstreamAuthorityIdentity,
    artifactApprovalId: binding.authority.artifactApprovalId,
    artifactApprovalEpoch: binding.authority.artifactApprovalEpoch,
    operations: binding.authority.operations.toSorted(),
    recipients: binding.authority.recipients.toSorted(),
    egress: binding.authority.egress.toSorted(),
    releaseClasses: binding.authority.releaseClasses.toSorted(),
    sharing: binding.authority.sharing,
    enforcementProfile: binding.authority.enforcementProfile,
    maximumExpiresAt: binding.authority.maximumExpiresAt,
  });
}

/** Proves that one fresh replacement is a strict, lineage-compatible authority subset. */
export function assertNarrowerRatchetAuthority(
  parent: RatchetBindingAuthority,
  replacement: RatchetBindingAuthority,
  nextExpiresAt: number,
): void {
  const before = parent.authority;
  const after = replacement.authority;
  if (replacement.name !== parent.name || replacement.requirementId !== parent.requirementId ||
      replacement.bindingId === parent.bindingId || replacement.bindingGeneration !== 1 ||
      replacement.contractInstanceId === parent.contractInstanceId ||
      replacement.contractInstanceGeneration !== 1 ||
      after.provider !== before.provider || after.resourceIdentity !== before.resourceIdentity ||
      after.upstreamAuthorityIdentity !== before.upstreamAuthorityIdentity ||
      after.artifactApprovalId !== before.artifactApprovalId ||
      after.artifactApprovalEpoch !== before.artifactApprovalEpoch ||
      after.sharing !== before.sharing || after.enforcementProfile !== before.enforcementProfile ||
      after.maximumExpiresAt > before.maximumExpiresAt || after.maximumExpiresAt > nextExpiresAt ||
      !subset(after.operations, before.operations) ||
      !subset(after.recipients, before.recipients) ||
      !subset(after.egress, before.egress) ||
      !subset(after.releaseClasses, before.releaseClasses)) {
    throw new Error("Trust Ratchet replacement is not a lineage-linked authority subset.");
  }
  const strictlyNarrower = after.maximumExpiresAt < before.maximumExpiresAt ||
    after.operations.length < before.operations.length ||
    after.recipients.length < before.recipients.length ||
    after.egress.length < before.egress.length ||
    after.releaseClasses.length < before.releaseClasses.length;
  if (!strictlyNarrower) throw new Error("Trust Ratchet replacement must reduce authority.");
}

function assertAcknowledgement(
  acknowledgement: RatchetEndpointAcknowledgement,
  transition: TrustRatchetTransition,
  binding: RatchetBindingAuthority,
  state: RatchetEndpointAcknowledgement["state"],
): void {
  if (acknowledgement.transitionId !== transition.id ||
      acknowledgement.taskId !== transition.taskId ||
      acknowledgement.taskGeneration !== transition.taskGeneration ||
      acknowledgement.leaseGeneration !== transition.leaseGeneration ||
      acknowledgement.environmentGeneration !== transition.nextEnvironmentGeneration ||
      acknowledgement.ratchetVersion !== transition.nextRatchetVersion ||
      acknowledgement.bindingId !== binding.bindingId ||
      acknowledgement.bindingGeneration !== binding.bindingGeneration ||
      acknowledgement.contractInstanceId !== binding.contractInstanceId ||
      acknowledgement.contractInstanceGeneration !== binding.contractInstanceGeneration ||
      acknowledgement.state !== state) {
    throw new Error("Trust Ratchet endpoint acknowledgement is stale or ambiguous.");
  }
}

function assertEnvironment(
  transition: TrustRatchetTransition,
  environment: RatchetEnvironmentSnapshot,
): void {
  if (!environment.taskActive || environment.taskId !== transition.taskId ||
      environment.taskGeneration !== transition.taskGeneration ||
      environment.leaseGeneration !== transition.leaseGeneration ||
      environment.absoluteExpiresAt !== transition.absoluteExpiresAt ||
      environment.generation !== transition.nextEnvironmentGeneration ||
      environment.ratchetVersion !== transition.nextRatchetVersion ||
      environment.leaseExpiresAt !== transition.nextExpiresAt ||
      JSON.stringify(environment.correlation) !== JSON.stringify(transition.correlation) ||
      JSON.stringify(environment.bindings) !== JSON.stringify(transition.nextBindings) ||
      JSON.stringify(environment.permanentlyRemoved) !==
        JSON.stringify(transition.permanentlyRemoved)) {
    throw new Error("Trust Ratchet committed an unexpected environment.");
  }
}

function assertPublication(
  transition: TrustRatchetTransition,
  acknowledgement: RatchetPublicationAcknowledgement,
): void {
  const bindings = transition.nextBindings.map(binding => ({
    bindingId: binding.bindingId,
    bindingGeneration: binding.bindingGeneration,
    contractInstanceId: binding.contractInstanceId,
    contractInstanceGeneration: binding.contractInstanceGeneration,
  }));
  if (acknowledgement.transitionId !== transition.id ||
      acknowledgement.taskId !== transition.taskId ||
      acknowledgement.taskGeneration !== transition.taskGeneration ||
      acknowledgement.leaseGeneration !== transition.leaseGeneration ||
      acknowledgement.environmentGeneration !== transition.nextEnvironmentGeneration ||
      acknowledgement.ratchetVersion !== transition.nextRatchetVersion ||
      JSON.stringify(acknowledgement.bindings) !== JSON.stringify(bindings)) {
    throw new Error("Trust Ratchet publication acknowledgement is stale or incomplete.");
  }
}

/** Enforcement-first coordinator for monotonic Task Environment replacement. */
export class TrustRatchet {
  constructor(readonly host: TrustRatchetHost) {}

  /** Validates, persists, applies, commits, and publishes one subset-only transition. */
  async transition(input: Readonly<{
    transitionId: string;
    taskId: string;
    expectedTaskGeneration: number;
    expectedEnvironmentGeneration: number;
    expectedRatchetVersion: number;
    nextExpiresAt: number;
    changes: readonly RatchetBindingChange[];
  }>): Promise<RatchetEnvironmentSnapshot> {
    const recovered = this.host.readTransition(input.transitionId);
    if (recovered?.state === "committed" && recovered.environment) {
      assertEnvironment(recovered.transition, recovered.environment);
      const canonical = this.host.readCurrent(recovered.transition.taskId);
      if (!canonical?.taskActive || JSON.stringify(canonical) !==
          JSON.stringify(recovered.environment)) {
        throw new Error("Trust Ratchet transition is obsolete and cannot be republished.");
      }
      const acknowledgement = await this.host.publishEnvironment(
        recovered.transition,
        recovered.environment,
      );
      assertPublication(recovered.transition, acknowledgement);
      return recovered.environment;
    }
    const current = this.host.readCurrent(input.taskId);
    if (!current?.taskActive || current.taskGeneration !== input.expectedTaskGeneration ||
        current.generation !== input.expectedEnvironmentGeneration ||
        current.ratchetVersion !== input.expectedRatchetVersion ||
        input.nextExpiresAt > current.leaseExpiresAt ||
        input.nextExpiresAt > current.absoluteExpiresAt) {
      throw new Error("Trust Ratchet parent environment is unavailable or stale.");
    }
    const byId = new Map(current.bindings.map(binding => [binding.bindingId, binding]));
    if (input.changes.length !== current.bindings.length ||
        new Set(input.changes.map(change => change.bindingId)).size !== current.bindings.length) {
      throw new Error("Trust Ratchet transition must classify every current Binding exactly once.");
    }
    const removed = new Set(current.permanentlyRemoved);
    const nextBindings: RatchetBindingAuthority[] = [];
    for (const change of input.changes) {
      const parent = byId.get(change.bindingId);
      if (!parent) throw new Error("Trust Ratchet transition cites an unknown Binding.");
      if (change.type === "retract") removed.add(fingerprint(parent));
      if (change.type === "retain") nextBindings.push(parent);
      if (change.type === "replace") {
        assertNarrowerRatchetAuthority(parent, change.replacement, input.nextExpiresAt);
        if (removed.has(fingerprint(change.replacement))) {
          throw new Error("Trust Ratchet cannot restore permanently removed authority.");
        }
        removed.add(fingerprint(parent));
        nextBindings.push(change.replacement);
      }
    }
    const transition: TrustRatchetTransition = {
      id: input.transitionId,
      taskId: current.taskId,
      taskGeneration: current.taskGeneration,
      leaseGeneration: current.leaseGeneration,
      absoluteExpiresAt: current.absoluteExpiresAt,
      correlation: structuredClone(current.correlation),
      parentEnvironmentGeneration: current.generation,
      parentRatchetVersion: current.ratchetVersion,
      nextEnvironmentGeneration: current.generation + 1,
      nextRatchetVersion: current.ratchetVersion + 1,
      nextExpiresAt: input.nextExpiresAt,
      changes: structuredClone(input.changes),
      nextBindings: structuredClone(nextBindings),
      permanentlyRemoved: [...removed].toSorted(),
    };
    await this.host.persistTransition(transition);
    await this.host.holdProtectedResults(transition);
    const prepared: RatchetEndpointAcknowledgement[] = [];
    for (const change of transition.changes) {
      if (change.type === "retract") continue;
      const binding = change.type === "replace" ? change.replacement : byId.get(change.bindingId)!;
      const acknowledgement = await this.host.prepareBinding(transition, binding);
      assertAcknowledgement(acknowledgement, transition, binding, "prepared");
      prepared.push(acknowledgement);
    }
    const invalidated: RatchetEndpointAcknowledgement[] = [];
    for (const predecessor of current.bindings) {
      const acknowledgement = await this.host.invalidatePredecessor(transition, predecessor);
      assertAcknowledgement(acknowledgement, transition, predecessor, "invalidated");
      invalidated.push(acknowledgement);
    }
    const latest = this.host.readCurrent(input.taskId);
    if (!latest || latest.generation !== current.generation ||
        latest.ratchetVersion !== current.ratchetVersion) {
      throw new Error("Trust Ratchet lost its canonical compare-and-swap race.");
    }
    const environment = await this.host.commitTransition(transition, prepared, invalidated);
    assertEnvironment(transition, environment);
    const acknowledgement = await this.host.publishEnvironment(transition, environment);
    assertPublication(transition, acknowledgement);
    return environment;
  }
}
