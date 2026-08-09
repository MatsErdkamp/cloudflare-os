/** Authority surface exercising the shared local-revocation protocol. */
export type RevocationAuthorityKind = "standing" | "task";

/** Terminal change requested for one live Binding. */
export type RevocationChangeKind = "retraction" | "replacement";

/** Failure boundary exercised while initially applying local revocation. */
export type InitialRevocationFailurePoint =
  | "commandValidation"
  | "replacementInstallation"
  | "replacementInstallationAcknowledgement"
  | "intentCommit"
  | "invalidationCall"
  | "invalidationAcknowledgement"
  | "terminalCommit"
  | "replacementPublication"
  | "cleanupScheduling";

/** Failure boundary exercised while reconstructing after a restart. */
export type RestartRevocationFailurePoint =
  | "restartInvalidation"
  | "restartAcknowledgement"
  | "restartReplacementInstallation"
  | "restartReplacementAcknowledgement"
  | "terminalCommit"
  | "restartPublication"
  | "restartCleanupScheduling";

/** Any failure boundary in the shared local-revocation protocol. */
export type RevocationFailurePoint =
  InitialRevocationFailurePoint | RestartRevocationFailurePoint;

/** Authority Event types emitted by the shared local-revocation protocol. */
export type RevocationAuthorityEventType =
  "invalidationStarted" | "bindingReplaced" | "bindingRetracted";

/** Bounded observable state used by standing and task conformance adapters. */
export interface RevocationConformanceSnapshot {
  /** Current canonical Binding generation. */
  bindingGeneration: number;
  /** Current canonical Binding lifecycle. */
  bindingLifecycle: "active" | "retracted";
  /** Durable operation phase, if an Invalidation Intent exists. */
  operationPhase: "invalidating" | "committed" | null;
  /** Ordered Authority Event types committed by the operation. */
  events: RevocationAuthorityEventType[];
  /** Whether predecessor cleanup responsibility is durably rooted. */
  cleanupRooted: boolean;
  /** Whether a cleanup runner is currently scheduled. */
  cleanupScheduled: boolean;
  /** Generation currently published to the Consumer, or null after restart. */
  publishedGeneration: number | null;
}

/** Observable result of one protected-result release attempt. */
export interface RevocationCallSnapshot {
  /** Furthest authority boundary crossed by the call. */
  stage: "began" | "crossedUpstream" | "producedProtectedResult" | "released";
  /** Terminal or pending caller outcome. */
  outcome:
    | "pending"
    | "completed"
    | "cancelledBeforeUpstream"
    | "rejectedResultProviderOutcomeUnknown";
  /** Whether an upstream provider action may already have occurred. */
  providerActionMayHaveOccurred: boolean;
  /** Whether a protected result remains retained for possible release. */
  protectedResultRetained: boolean;
}

/** Adapter implemented by both standing and Agent Task authority slices. */
export interface RevocationConformanceHarness {
  /** Run the operation until the named injected failure. */
  runUntilFailure(point: InitialRevocationFailurePoint): Promise<void>;
  /** Discard all volatile runtime state and reconstruct a fresh adapter from durable state only. */
  crashAndRestart(): Promise<RevocationConformanceHarness>;
  /** Run one reconciliation pass, optionally failing at a restart boundary. */
  reconcile(point?: RestartRevocationFailurePoint): Promise<void>;
  /** Read bounded canonical/runtime state. */
  snapshot(): RevocationConformanceSnapshot;
  /** Attempt to publish the original Binding generation. */
  attemptOldGenerationPublication(): Promise<boolean>;
  /** Begin one protected-result release under the currently published generation. */
  beginCall(): Promise<string>;
  /** Cross the call's Upstream Authority boundary. */
  crossUpstream(callId: string): Promise<void>;
  /** Produce and quarantine a protected result. */
  produceProtectedResult(callId: string): Promise<void>;
  /** Attempt to release the protected result to its Consumer. */
  releaseProtectedResult(callId: string): Promise<boolean>;
  /** Read one call's bounded state. */
  callSnapshot(callId: string): RevocationCallSnapshot;
  /** Replay the completed command under its original operation identity. */
  replayCompletedCommand(): Promise<void>;
  /** Repeat invalidation and acknowledgement for the exact old generation. */
  repeatInvalidationAndAcknowledgement(): Promise<void>;
  /** Submit a duplicate generation-bound enforcement callback. */
  submitDuplicateCallback(): Promise<void>;
}

/** Factory for one implementation-specific revocation conformance adapter. */
export type RevocationConformanceFactory = (options: {
  /** Authority surface under test. */
  authorityKind: RevocationAuthorityKind;
  /** Retraction or generation-CAS replacement. */
  changeKind: RevocationChangeKind;
}) => Promise<RevocationConformanceHarness>;

/** One runner-neutral conformance case registered by a concrete test module. */
export interface RevocationConformanceCase {
  /** Human-readable case name. */
  name: string;
  /** Execute the case and reject on an invariant violation. */
  run(): Promise<void>;
}

const initialFailurePoints: InitialRevocationFailurePoint[] = [
  "commandValidation",
  "replacementInstallation",
  "replacementInstallationAcknowledgement",
  "intentCommit",
  "invalidationCall",
  "invalidationAcknowledgement",
  "terminalCommit",
  "replacementPublication",
  "cleanupScheduling",
];

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected)
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

function assertArrayEqual(
  actual: RevocationAuthorityEventType[],
  expected: RevocationAuthorityEventType[],
  message: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${message}: expected ${expected.join(",")}, received ${actual.join(",")}`,
    );
  }
}

/**
 * Builds the shared crash, no-resurrection, atomicity, and in-flight-result cases.
 * Production standing and task test modules register these runner-neutral cases unchanged.
 */
export function revocationProtocolConformanceCases(
  createHarness: RevocationConformanceFactory,
): RevocationConformanceCase[] {
  const cases: RevocationConformanceCase[] = [];
  for (const authorityKind of ["standing", "task"] as const) {
    for (const changeKind of ["retraction", "replacement"] as const) {
      for (const initialFailure of initialFailurePoints) {
        if (
          changeKind === "retraction" &&
          [
            "replacementInstallation",
            "replacementInstallationAcknowledgement",
            "replacementPublication",
          ].includes(initialFailure)
        )
          continue;

        cases.push({
          name: `${authorityKind} ${changeKind} recovers ${initialFailure} without resurrection`,
          run: async () => {
            let harness = await createHarness({ authorityKind, changeKind });
            await harness.runUntilFailure(initialFailure);
            harness = await harness.crashAndRestart();

            if (
              initialFailure === "commandValidation" ||
              initialFailure === "replacementInstallation" ||
              initialFailure === "replacementInstallationAcknowledgement" ||
              initialFailure === "intentCommit"
            ) {
              assertEqual(
                harness.snapshot().operationPhase,
                null,
                "failed intent wrote an operation",
              );
              await harness.reconcile();
              assertEqual(
                harness.snapshot().publishedGeneration,
                1,
                "active authority did not recover",
              );
              return;
            }

            await harness.reconcile();

            const snapshot = harness.snapshot();
            assertEqual(snapshot.bindingGeneration, 2, "terminal generation");
            assertEqual(
              snapshot.bindingLifecycle,
              changeKind === "replacement" ? "active" : "retracted",
              "terminal lifecycle",
            );
            assertEqual(snapshot.cleanupRooted, true, "cleanup responsibility");
            assertEqual(snapshot.cleanupScheduled, true, "cleanup scheduling");
            assertEqual(
              await harness.attemptOldGenerationPublication(),
              false,
              "old publication",
            );
            assertEqual(
              snapshot.publishedGeneration,
              changeKind === "replacement" ? 2 : null,
              "published generation",
            );
          },
        });
      }
    }
  }

  for (const restartFailure of [
    "restartInvalidation",
    "restartAcknowledgement",
    "restartReplacementInstallation",
    "restartReplacementAcknowledgement",
    "terminalCommit",
    "restartPublication",
    "restartCleanupScheduling",
  ] satisfies RestartRevocationFailurePoint[]) {
    cases.push({
      name: `restart failure ${restartFailure} remains recoverable`,
      run: async () => {
        const initialFailure =
          restartFailure === "restartPublication"
            ? "replacementPublication"
            : restartFailure === "restartReplacementInstallation" ||
                restartFailure === "restartReplacementAcknowledgement"
              ? "replacementPublication"
              : restartFailure === "restartCleanupScheduling"
                ? "cleanupScheduling"
                : "terminalCommit";
        let harness = await createHarness({
          authorityKind: "task",
          changeKind: "replacement",
        });
        await harness.runUntilFailure(initialFailure);
        harness = await harness.crashAndRestart();
        let failed = false;
        try {
          await harness.reconcile(restartFailure);
        } catch (error) {
          failed =
            error instanceof Error && error.message.includes(restartFailure);
        }
        assertEqual(failed, true, "restart failure was not injected");
        harness = await harness.crashAndRestart();
        await harness.reconcile();
        const snapshot = harness.snapshot();
        assertEqual(
          snapshot.bindingGeneration,
          2,
          "restart terminal generation",
        );
        assertEqual(
          snapshot.bindingLifecycle,
          "active",
          "restart terminal lifecycle",
        );
        assertEqual(
          snapshot.operationPhase,
          "committed",
          "restart operation phase",
        );
        assertEqual(
          snapshot.cleanupRooted,
          true,
          "restart cleanup responsibility",
        );
        assertEqual(
          snapshot.cleanupScheduled,
          true,
          "restart cleanup scheduling",
        );
        assertEqual(snapshot.publishedGeneration, 2, "restart publication");
        assertEqual(
          await harness.attemptOldGenerationPublication(),
          false,
          "restart old publication",
        );
      },
    });
  }

  cases.push({
    name: "canonical state, terminal event, and cleanup root roll back together",
    run: async () => {
      const harness = await createHarness({
        authorityKind: "standing",
        changeKind: "retraction",
      });
      await harness.runUntilFailure("terminalCommit");
      const snapshot = harness.snapshot();
      assertEqual(snapshot.bindingGeneration, 1, "rolled-back generation");
      assertEqual(snapshot.bindingLifecycle, "active", "rolled-back lifecycle");
      assertEqual(
        snapshot.operationPhase,
        "invalidating",
        "durable intent phase",
      );
      assertArrayEqual(
        snapshot.events,
        ["invalidationStarted"],
        "rolled-back terminal event",
      );
      assertEqual(snapshot.cleanupRooted, false, "rolled-back cleanup root");
    },
  });

  cases.push({
    name: "in-flight results are cancelled at the last crossed authority boundary",
    run: async () => {
      const harness = await createHarness({
        authorityKind: "task",
        changeKind: "retraction",
      });
      const released = await harness.beginCall();
      await harness.crossUpstream(released);
      await harness.produceProtectedResult(released);
      assertEqual(
        await harness.releaseProtectedResult(released),
        true,
        "pre-cutover release",
      );

      const began = await harness.beginCall();
      const crossed = await harness.beginCall();
      await harness.crossUpstream(crossed);
      const produced = await harness.beginCall();
      await harness.crossUpstream(produced);
      await harness.produceProtectedResult(produced);

      await harness.runUntilFailure("terminalCommit");
      const beganSnapshot = harness.callSnapshot(began);
      assertEqual(
        beganSnapshot.outcome,
        "cancelledBeforeUpstream",
        "began-only call",
      );
      assertEqual(
        beganSnapshot.providerActionMayHaveOccurred,
        false,
        "began-only upstream state",
      );
      const crossedSnapshot = harness.callSnapshot(crossed);
      assertEqual(
        crossedSnapshot.outcome,
        "rejectedResultProviderOutcomeUnknown",
        "upstream-crossed call",
      );
      assertEqual(
        crossedSnapshot.providerActionMayHaveOccurred,
        true,
        "upstream outcome state",
      );
      const producedSnapshot = harness.callSnapshot(produced);
      assertEqual(
        producedSnapshot.outcome,
        "rejectedResultProviderOutcomeUnknown",
        "protected-result call",
      );
      assertEqual(
        producedSnapshot.protectedResultRetained,
        false,
        "protected result quarantine",
      );
      assertEqual(
        harness.callSnapshot(released).outcome,
        "completed",
        "pre-cutover completion",
      );
    },
  });

  cases.push({
    name: "completed command, invalidation, acknowledgement, callback, and reconciliation are idempotent",
    run: async () => {
      const harness = await createHarness({
        authorityKind: "task",
        changeKind: "replacement",
      });
      await harness.runUntilFailure("cleanupScheduling");
      await harness.replayCompletedCommand();
      await harness.repeatInvalidationAndAcknowledgement();
      await harness.submitDuplicateCallback();
      await harness.reconcile();
      const beforeReplay = JSON.stringify(harness.snapshot());
      await harness.replayCompletedCommand();
      await harness.repeatInvalidationAndAcknowledgement();
      await harness.submitDuplicateCallback();
      await harness.reconcile();
      assertEqual(
        JSON.stringify(harness.snapshot()),
        beforeReplay,
        "idempotent replay changed observable state",
      );
      assertEqual(
        await harness.attemptOldGenerationPublication(),
        false,
        "idempotent replay restored old authority",
      );
    },
  });

  return cases;
}
