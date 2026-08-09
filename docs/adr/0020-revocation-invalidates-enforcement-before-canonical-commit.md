---
status: accepted
---

# Revocation invalidates enforcement before canonical commit

## Context

Binding Enforcement Endpoints execute from acknowledged immutable generation snapshots. They cannot
read canonical Workspace state on every call. If Workspace Authority were to commit a terminal
Binding state before invalidating those endpoints, a crash could leave revocation externally visible
while an old capability graph still released protected results. If it invalidated first without a
durable operation, a crash could strand active canonical authority with no proof of what repair was
allowed to do.

The issue #23 executable model injected failures at command validation, durable intent, endpoint
invalidation, acknowledgement, canonical state/event commit, replacement publication, restart, and
cleanup scheduling for both retraction and replacement. Every case either left the original
authority unchanged before durable intent or converged without republishing the old generation.

## Decision

Workspace Authority uses an enforcement-first, intent-rooted sequence:

1. Validate the command, actor, operation digest, expected revisions, exact old Binding generation,
   and replacement inputs, if any. A failed validation writes nothing.
2. For replacement, prepare and obtain an installation acknowledgement from the unpublished new
   Binding Enforcement Endpoint. It confers no authority.
3. Atomically persist one **Invalidation Intent** with the exact old generation, terminal target or
   replacement generation, affected endpoint set and acknowledgement requirements. Append the
   bounded `invalidationStarted` Authority Event in the same transaction. From this point, no path may
   republish or newly materialize the old generation.
4. Invalidate every materialized old-generation enforcement endpoint and wait for an acknowledgement
   that no old root, child, callback, restored capability, iterator, subscription, stream mediator, or
   protected-result release gate can succeed. A missing or ambiguous acknowledgement is failure, not
   completion. Unsupported shapes already fail closed.
5. Recheck the Invalidation Intent, command preconditions, old canonical generation, endpoint set, and
   acknowledgement generation. Then perform the **Revocation Commit Point** as one Workspace
   transaction: retract or generation-CAS replace the Binding, update Consumer readiness and
   environment generation, append the terminal Authority Events, mark the operation committed, and
   root every predecessor cleanup obligation. Failure of any write, including event append or cleanup
   rooting, rolls the whole transaction back.
6. Publish only the exact acknowledged new generation, after canonical revalidation. Provider and
   predecessor cleanup then run through durable Authority Effects. Alarm scheduling is a repair hint;
   its failure cannot erase cleanup responsibility.

The Revocation Commit Point is the exact externally visible **authority-status completion** of local
revocation or replacement: it is when the command may return completed and bounded status may report
the Binding retracted or replaced. During the earlier enforcement cutover, an old caller can observe
generic endpoint unavailability or cancellation. That is deliberate over-revocation, not a terminal
revocation result, and it discloses no lifecycle reason. An API may expose the operation as
`invalidationPending`, but must not report terminal Binding state until the transaction commits.
Contract stub disposal is client hygiene, endpoint invalidation is enforcement, and provider cleanup
is an external Effect; none is the authority-status commit point.

This sequence applies identically to standing and Agent Task Bindings. Agent Task, Task Environment,
and Trust Ratchet generations are additional exact snapshot inputs, not another protocol.

## In-flight operations

Invalidation acknowledgement closes every protected-result release gate for the old generation. An
operation's outcome is determined by the furthest boundary it crossed before acknowledgement:

| State before acknowledgement                       | Required result                                                                                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Began but did not cross Upstream Authority         | Cancel or reject as stale; it must not invoke upstream authority.                                                                                                                                                                                   |
| Crossed Upstream Authority                         | The provider action may already have occurred and remains task-neutral Source Activity evidence, but a result completing after acknowledgement is quarantined and rejected. Cleanup or compensation is an explicit Effect, never inferred rollback. |
| Produced a protected result but did not release it | Destroy or quarantine the result and reject the call. It never reaches Consumer or model context.                                                                                                                                                   |
| Released the complete protected result             | It may complete only if release crossed its generation gate before acknowledgement. This necessarily precedes the Revocation Commit Point.                                                                                                          |

Invocation start and provider completion alone never grandfather result release. Parallel calls and
asynchronous continuations obey the same release gate. A transferred raw stream has no such gate and
therefore remains unsupported; a supported stream or iterator must mediate every item and terminal
result. The system does not claim that it can undo a provider side effect which crossed the upstream
boundary before invalidation.

## Crash states and repair

The protocol names partial states instead of describing them as generic failure:

| State                                 | Durable/capability condition                                                                                                      | Only permitted reconciliation                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Invalidation lag**                  | Intent committed; old canonical Binding and endpoint remain active.                                                               | Retry invalidation for the intent's exact old generation. Never publish another old endpoint.                                      |
| **Enforcement-first over-revocation** | Old endpoint is unreachable, but canonical Binding still says active because acknowledgement or terminal commit did not complete. | Repeat invalidation idempotently, reacquire acknowledgement, and finish the same terminal transaction. Never restore reachability. |
| **Publication lag**                   | Replacement is canonically active, but its exact new endpoint is not published.                                                   | Revalidate canonical and acknowledged generations, then publish that endpoint; otherwise keep it unreachable.                      |
| **Cleanup lag**                       | Revocation is committed and cleanup responsibility is durable, but no cleanup runner is scheduled or the provider is unavailable. | Reconstruct scheduling from the cleanup/effect index and retry without restoring authority.                                        |

On restart, persisted Intent, canonical records, operation phase, endpoint identities, terminal Events,
and cleanup roots are sufficient. Ephemeral acknowledgements are never assumed: reconciliation repeats
idempotent invalidation and reacquires them. A callback or acknowledgement is evidence only until the
terminal transaction rechecks it. An old generation cannot be republished after Invalidation Intent,
even if canonical state still temporarily calls it active. A new generation cannot be published merely
because its Facet exists or once acknowledged in the past.

## Conformance

The retained conformance contract is parameterized by `standing` and `task` authority kinds and must
be reused by their implementation slices. Each adapter must inject failure before and after every
durable transaction, invalidation RPC, acknowledgement, publication, restart reconstruction, and
cleanup scheduling boundary. It must also prove stale roots, children, callbacks, restored
capabilities, parallel calls, streams/iterators, expired leases, old Binding generations, and old Task
Environment/Ratchet generations fail closed wherever the adapter supports those shapes.

The minimum deterministic assertions are:

- state and terminal Authority Events roll back together;
- no terminal state is externally visible before complete invalidation acknowledgement;
- no protected result crosses an old release gate after acknowledgement;
- restart never restores or republishes the old generation;
- publication lag repairs only the exact canonical replacement;
- cleanup scheduling failure preserves durable responsibility; and
- repeated commands, invalidations, acknowledgements, callbacks, and reconciliation are idempotent.

## Considered options

- **Canonical commit before invalidation** was rejected because a crash can expose terminal state while
  old snapshot-based endpoints remain usable.
- **Invalidation without durable intent** was rejected because restart could not distinguish a planned
  terminal transition from accidental endpoint loss and might rematerialize the old generation.
- **Treat invalidation acknowledgement as the visible revocation** was rejected because canonical
  records and Authority Events would still deny that the transition completed.
- **Wait for provider cleanup before completion** was rejected because external availability must not
  delay or restore local authority removal.

## Evidence

- Prototype branch: `codex/prototype-crash-safe-local-revocation`, commit `5478a00d`
- Executable model: 35 passing standing/task retraction, replacement, failure, restart,
  in-flight, and cleanup cases
- Human-drivable state explorer: one self-contained HTML file with free play and four guided scenarios
- Retained runner-neutral conformance contract and reference adapter: 40 passing cases in the
  Cloudflare Workers Vitest pool
