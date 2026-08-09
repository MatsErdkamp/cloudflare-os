import { describe, expect, test } from "vitest";
import {
  revocationProtocolConformanceCases,
  type InitialRevocationFailurePoint,
  type RestartRevocationFailurePoint,
  type RevocationAuthorityEventType,
  type RevocationAuthorityKind,
  type RevocationCallSnapshot,
  type RevocationChangeKind,
  type RevocationConformanceHarness,
  type RevocationConformanceSnapshot,
  type RevocationFailurePoint,
} from "./revocation-protocol-conformance";

interface WorkspaceState {
  binding: { generation: number; lifecycle: "active" | "retracted" };
  operation: {
    phase: "invalidating" | "committed";
    oldGeneration: number;
    targetGeneration: number | null;
  } | null;
  events: RevocationAuthorityEventType[];
  cleanupRoots: Array<{ generation: number; state: "pending" }>;
}

class InjectedFailure extends Error {
  constructor(readonly point: RevocationFailurePoint) {
    super(`injected failure at ${point}`);
  }
}

class ReferenceProtectedResultRelease {
  readonly snapshot: RevocationCallSnapshot = {
    stage: "began",
    outcome: "pending",
    providerActionMayHaveOccurred: false,
    protectedResultRetained: false,
  };

  cancelForInvalidation(): void {
    if (this.snapshot.outcome === "completed") return;
    this.snapshot.outcome = this.snapshot.providerActionMayHaveOccurred
      ? "rejectedResultProviderOutcomeUnknown"
      : "cancelledBeforeUpstream";
    this.snapshot.protectedResultRetained = false;
  }
}

class ReferenceBindingEnforcementEndpoint {
  releaseAllowed = true;
  snapshotAcknowledged = false;
  readonly calls = new Set<ReferenceProtectedResultRelease>();

  constructor(readonly generation: number) {}

  invalidateAndAcknowledge(): void {
    this.releaseAllowed = false;
    for (const call of this.calls) call.cancelForInvalidation();
  }

  installAndAcknowledgeSnapshot(): void {
    this.snapshotAcknowledged = true;
  }
}

class ReferenceRuntime {
  readonly endpoints = new Map<number, ReferenceBindingEnforcementEndpoint>();
  readonly calls = new Map<string, ReferenceProtectedResultRelease>();
  publishedGeneration: number | null = null;
  nextCallId = 1;

  materialize(generation: number): ReferenceBindingEnforcementEndpoint {
    let endpoint = this.endpoints.get(generation);
    if (!endpoint) {
      endpoint = new ReferenceBindingEnforcementEndpoint(generation);
      this.endpoints.set(generation, endpoint);
    }
    return endpoint;
  }

  breakAllTransports(): void {
    for (const endpoint of this.endpoints.values())
      endpoint.invalidateAndAcknowledge();
    this.publishedGeneration = null;
  }
}

class ReferenceRevocationHarness implements RevocationConformanceHarness {
  private runtime = new ReferenceRuntime();
  private cleanupScheduled = false;

  private constructor(
    private readonly authorityKind: RevocationAuthorityKind,
    private readonly changeKind: RevocationChangeKind,
    private workspaceState: WorkspaceState,
    initializeRuntime: boolean,
  ) {
    if (initializeRuntime) {
      this.runtime.materialize(1).installAndAcknowledgeSnapshot();
      this.runtime.publishedGeneration = 1;
    }
  }

  static create(options: {
    authorityKind: RevocationAuthorityKind;
    changeKind: RevocationChangeKind;
  }): ReferenceRevocationHarness {
    return new ReferenceRevocationHarness(
      options.authorityKind,
      options.changeKind,
      {
        binding: { generation: 1, lifecycle: "active" },
        operation: null,
        events: [],
        cleanupRoots: [],
      },
      true,
    );
  }

  private fail(
    point: RevocationFailurePoint,
    injected?: RevocationFailurePoint,
  ): void {
    if (point === injected) throw new InjectedFailure(point);
  }

  private transaction(
    point: RevocationFailurePoint,
    injected: RevocationFailurePoint | undefined,
    mutate: (draft: WorkspaceState) => void,
  ): void {
    const draft = structuredClone(this.workspaceState);
    mutate(draft);
    this.fail(point, injected);
    this.workspaceState = draft;
  }

  private validate(): void {
    expect(this.workspaceState.binding).toEqual({
      generation: 1,
      lifecycle: "active",
    });
    expect(this.workspaceState.operation).toBeNull();
  }

  private publish(generation: number): boolean {
    const endpoint = this.runtime.endpoints.get(generation);
    if (
      this.workspaceState.binding.lifecycle !== "active" ||
      this.workspaceState.binding.generation !== generation ||
      !endpoint?.releaseAllowed ||
      !endpoint.snapshotAcknowledged ||
      (this.workspaceState.operation &&
        this.workspaceState.operation.phase !== "committed")
    ) {
      return false;
    }
    this.runtime.publishedGeneration = generation;
    return true;
  }

  private commitTerminal(injected?: RevocationFailurePoint): void {
    expect(this.runtime.endpoints.get(1)?.releaseAllowed).toBe(false);
    this.transaction("terminalCommit", injected, (draft) => {
      expect(draft.operation?.phase).toBe("invalidating");
      if (this.changeKind === "replacement") {
        draft.binding = { generation: 2, lifecycle: "active" };
        draft.events.push("bindingReplaced");
      } else {
        draft.binding = { generation: 2, lifecycle: "retracted" };
        draft.events.push("bindingRetracted");
      }
      draft.cleanupRoots.push({ generation: 1, state: "pending" });
      if (draft.operation) draft.operation.phase = "committed";
    });
  }

  private run(injected: InitialRevocationFailurePoint): void {
    this.fail("commandValidation", injected);
    this.validate();
    if (this.changeKind === "replacement") {
      this.fail("replacementInstallation", injected);
      const replacement = this.runtime.materialize(2);
      replacement.installAndAcknowledgeSnapshot();
      this.fail("replacementInstallationAcknowledgement", injected);
    }
    this.transaction("intentCommit", injected, (draft) => {
      draft.operation = {
        phase: "invalidating",
        oldGeneration: 1,
        targetGeneration: this.changeKind === "replacement" ? 2 : null,
      };
      draft.events.push("invalidationStarted");
    });
    this.fail("invalidationCall", injected);
    this.runtime.endpoints.get(1)?.invalidateAndAcknowledge();
    this.fail("invalidationAcknowledgement", injected);
    this.commitTerminal(injected);
    if (this.changeKind === "replacement") {
      this.fail("replacementPublication", injected);
      expect(this.publish(2)).toBe(true);
    }
    this.fail("cleanupScheduling", injected);
    this.cleanupScheduled = true;
  }

  async runUntilFailure(point: InitialRevocationFailurePoint): Promise<void> {
    try {
      this.run(point);
    } catch (error) {
      if (error instanceof InjectedFailure && error.point === point) return;
      throw error;
    }
    throw new Error(`failure point was not reached: ${point}`);
  }

  async crashAndRestart(): Promise<RevocationConformanceHarness> {
    this.runtime.breakAllTransports();
    return new ReferenceRevocationHarness(
      this.authorityKind,
      this.changeKind,
      structuredClone(this.workspaceState),
      false,
    );
  }

  async reconcile(injected?: RestartRevocationFailurePoint): Promise<void> {
    const operation = this.workspaceState.operation;
    if (!operation) {
      if (this.workspaceState.binding.lifecycle === "active") {
        this.runtime
          .materialize(this.workspaceState.binding.generation)
          .installAndAcknowledgeSnapshot();
        expect(this.publish(this.workspaceState.binding.generation)).toBe(true);
      }
      return;
    }

    if (operation.phase === "invalidating") {
      this.fail("restartInvalidation", injected);
      this.runtime
        .materialize(operation.oldGeneration)
        .invalidateAndAcknowledge();
      this.fail("restartAcknowledgement", injected);
      this.commitTerminal(injected);
    }
    if (
      this.changeKind === "replacement" &&
      this.runtime.publishedGeneration !== 2
    ) {
      this.fail("restartReplacementInstallation", injected);
      const replacement = this.runtime.materialize(2);
      replacement.installAndAcknowledgeSnapshot();
      this.fail("restartReplacementAcknowledgement", injected);
      this.fail("restartPublication", injected);
      expect(this.publish(2)).toBe(true);
    }
    if (
      this.workspaceState.cleanupRoots.some((root) => root.state === "pending")
    ) {
      this.fail("restartCleanupScheduling", injected);
      this.cleanupScheduled = true;
    }
  }

  snapshot(): RevocationConformanceSnapshot {
    return {
      bindingGeneration: this.workspaceState.binding.generation,
      bindingLifecycle: this.workspaceState.binding.lifecycle,
      operationPhase: this.workspaceState.operation?.phase ?? null,
      events: [...this.workspaceState.events],
      cleanupRooted: this.workspaceState.cleanupRoots.length > 0,
      cleanupScheduled: this.cleanupScheduled,
      publishedGeneration: this.runtime.publishedGeneration,
    };
  }

  async attemptOldGenerationPublication(): Promise<boolean> {
    this.runtime.materialize(1);
    return this.publish(1);
  }

  async beginCall(): Promise<string> {
    const endpoint = this.runtime.endpoints.get(
      this.runtime.publishedGeneration ?? -1,
    );
    if (!endpoint?.releaseAllowed) throw new Error("endpoint unavailable");
    const id = `call-${this.runtime.nextCallId++}`;
    const call = new ReferenceProtectedResultRelease();
    endpoint.calls.add(call);
    this.runtime.calls.set(id, call);
    return id;
  }

  async crossUpstream(callId: string): Promise<void> {
    const call = this.getCall(callId);
    call.snapshot.stage = "crossedUpstream";
    call.snapshot.providerActionMayHaveOccurred = true;
  }

  async produceProtectedResult(callId: string): Promise<void> {
    const call = this.getCall(callId);
    expect(call.snapshot.providerActionMayHaveOccurred).toBe(true);
    call.snapshot.stage = "producedProtectedResult";
    call.snapshot.protectedResultRetained = true;
  }

  async releaseProtectedResult(callId: string): Promise<boolean> {
    const call = this.getCall(callId);
    const endpoint = [...this.runtime.endpoints.values()].find((candidate) =>
      candidate.calls.has(call),
    );
    if (!endpoint?.releaseAllowed || !call.snapshot.protectedResultRetained)
      return false;
    call.snapshot.stage = "released";
    call.snapshot.outcome = "completed";
    call.snapshot.protectedResultRetained = false;
    return true;
  }

  callSnapshot(callId: string): RevocationCallSnapshot {
    return { ...this.getCall(callId).snapshot };
  }

  async replayCompletedCommand(): Promise<void> {
    if (this.workspaceState.operation?.phase !== "committed")
      throw new Error("completed operation unavailable");
  }

  async repeatInvalidationAndAcknowledgement(): Promise<void> {
    this.runtime.materialize(1).invalidateAndAcknowledge();
  }

  async submitDuplicateCallback(): Promise<void> {
    if (this.workspaceState.operation?.phase !== "committed")
      throw new Error("callback operation unavailable");
  }

  private getCall(callId: string): ReferenceProtectedResultRelease {
    const call = this.runtime.calls.get(callId);
    if (!call) throw new Error(`unknown call: ${callId}`);
    return call;
  }
}

describe("reference revocation protocol", () => {
  const cases = revocationProtocolConformanceCases(async (options) =>
    ReferenceRevocationHarness.create(options),
  );
  for (const conformanceCase of cases)
    test(conformanceCase.name, conformanceCase.run);
});
