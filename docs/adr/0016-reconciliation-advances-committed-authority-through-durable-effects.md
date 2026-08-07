# Reconciliation advances committed authority through durable effects

Workspace Authority uses a workspace-local reconciliation loop to advance and repair decisions that have already committed. The loop is deliberately not a policy engine: it may preserve an exact eligible tuple, complete its exact external work, or reduce authority, but it never selects a Source, changes an Authority Mode, redirects a Binding, widens a Consumer assignment, or fabricates success. External work is represented by durable Authority Effects, while current authority remains the canonical records owned by the workspace Durable Object.

## Invariants

Reconciliation obeys these rules before availability or convenience:

- canonical authority records, not events, queues, caches, provider state, or Gadget-local projections, are the source of truth;
- every local transition and its Authority Events commit in one `AuthorityStore.mutate()` transaction;
- every external call has one previously persisted exact Effect, stable idempotency identity, and non-secret input digest;
- no external call runs inside a Durable Object storage transaction or `blockConcurrencyWhile()`;
- a callback or external outcome is evidence only until a transaction rechecks the exact decision, record revisions, Authority Generations, immutable versions/epochs, and expected Binding generation;
- unknown state never becomes success, failure, a Source choice, an Authority Mode choice, or a fallback;
- local suspension, expiry, Retraction, and generation invalidation do not wait for remote cleanup;
- a new Contract Instance is unreachable and hook-disabled until one exact Binding compare-and-swap publishes it;
- after compare-and-swap, the new Binding remains authoritative even when predecessor or provider cleanup is pending;
- no-op reconciliation writes no state and emits no Authority Event.

An Authority Session is not needed to reconcile. Human permission is checked when a decision commits. The system may later finish that decision's exact Effects after the actor loses permission, provided the decision and every safety generation remain current. A changed tuple requires another live Authority Manager decision.

## Work discovery and the plan/apply boundary

`authorityReconcileQueue` is a durable, coalescing work index keyed by `(subject kind, subject ID)`. A marker stores the highest causal Authority Event sequence, bounded trigger reasons, and earliest due time. The transaction that changes an Account, Source, receipt, Approval, Consumer, Requirement, instance, Binding, Registration, Grant, lease, Plan, or Effect also upserts every affected marker through indexed dependents. The queue is a repair hint, not authority and not a second desired-state store.

Reconciliation is triggered by:

- a committed authority command or lifecycle transition;
- an authenticated, generation-checked Gatekeeper or workload-adapter callback;
- Development Session create, resume, renewal, expiry, or disconnect;
- Workload attach, rotation deadline, suspension, or retirement;
- verification and Credential Health refresh deadlines;
- an Authority Effect outcome, claim timeout, retry deadline, or explicit repair command;
- Durable Object initialization when due queue/effect/deadline indexes are non-empty;
- the workspace alarm.

A bounded reconciliation pass has two phases:

1. **Plan transaction.** Read one canonical subject and its indexed dependents, evaluate deterministic eligibility/readiness, commit any immediate authority reduction and events, mark obsolete work, and create or reuse exact Effects. It may create a bounded Authority Proposal when expansion or redirect needs human review, but it cannot decide it.
2. **Apply outside storage.** Claim due Effects, call adapters or Contract Runtime, then submit bounded outcomes to a second transaction. That transaction accepts the outcome only if the claim and all exact preconditions still match; otherwise it records the Effect obsolete or schedules compensating cleanup without publishing stale authority.

The planner never scans the whole workspace on an ordinary pass. It follows indexes from the dirty subject. A startup integrity sweep is bounded and resumable and verifies that every live deadline and nonterminal Effect has a queue/alarm root; it does not recompute decisions from display metadata.

One pass processes at most 32 local subjects and 16 external Effects. Remaining due work schedules an immediate continuation alarm. External calls may run concurrently only across different serialization lanes; the lane is the affected Account, Source, Registration, Contract Instance, or `(Consumer, binding name)`. One lane has at most one claimed Effect.

## Authority Effect protocol

An Effect is immutable in kind and input and mutable only in execution metadata. It stores:

- authority-issued Effect ID, Authority Operation ID, and step key;
- effect kind, target stable ID, serialization lane, and causal sequence;
- canonical non-secret input digest plus references to the committed decision and immutable inputs;
- every expected revision, generation, version/epoch, and Binding generation needed to accept an outcome;
- state, attempt count, claim token/deadline, next-attempt time, bounded reason code, and safe diagnostics;
- adapter idempotency/probe profile and eventual outcome reference;
- cleanup responsibility even after its target becomes terminal.

The state machine is:

```text
pending → claimed → succeeded
              ├─ retryScheduled → claimed
              ├─ outcomeUnknown → claimed (probe first)
              ├─ obsolete → cleanup pending/succeeded
              └─ deadLetter
```

`succeeded`, `obsolete`, and a confirmed cleanup outcome are terminal. `deadLetter` stops automatic hot retries but is not success and does not erase responsibility.

An Effect ID is the idempotency key presented to an adapter. The same Effect never changes input. A logically changed call creates another Effect under another Operation step. An adapter is conformant only if it either:

- applies the same Effect ID idempotently and returns the same resource/outcome; or
- can probe an exact provider resource or operation reference before any replay.

If neither is possible, the external write cannot be automatic. It becomes a human-controlled Effect whose UI explains that the prior outcome is unknown.

The claim transaction rechecks preconditions and writes a random claim token and bounded `claimUntil`. A caller timeout or expired claim moves the Effect to `outcomeUnknown`; recovery probes before replaying. Outcome submission must present the claim token and adapter result. A late outcome for an expired or superseded claim may update safe observation metadata, but it cannot mutate authority unless the outcome transaction's full preconditions still match.

The transaction that makes an Effect executable appends its durable intent/first-attempt Authority Event before any call. A retry whose only changes are attempt count, claim, or backoff is an operational log; a retry that changes visible state, cleanup responsibility, or terminal outcome appends the corresponding event.

Provider-created resources use the Effect ID as their external correlation where supported. Stable local IDs are allocated before the call. Retries never allocate another Account, Source, receipt, Registration credential, or Contract Instance identity.

## Ordering by operation

### Create or prepare

The decision transaction persists exact intent and Effect. The adapter prepares the resource or Contract Instance off-binding. The outcome transaction verifies identity, generations, evidence, and Artifact/decision inputs before marking it prepared. Preparation alone changes no Consumer Binding.

### Activate or replace

Workspace Authority verifies current Source/receipt/Approval eligibility, then uses one transaction to compare-and-swap the expected `(Consumer, binding name, Binding generation)` to the prepared instance. The transaction increments the Binding and environment generations, records Resolution and lineage, changes readiness, creates predecessor cleanup Effects, and appends contiguous events. A stale CAS activates nothing; the prepared instance becomes obsolete and is cleaned under the same Operation.

For a multi-binding Development Session or graduation target, every required Binding publishes in one Consumer transaction. Optional ready Bindings may publish in that transaction; optional unavailable Bindings remain explicit diagnostics. A replacement being prepared does not disturb an eligible current Binding.

### Suspend and reactivate

A recoverable positive failure such as `attentionRequired` commits suspension and generation invalidation locally before any provider work. It retains the Approval, Installation Decision, Binding name, and intended Resolution. Exact reactivation is automatic only when the same Account, grant, Source, verifier, Approval, Consumer, Requirement, instance, and Binding generations remain the cited tuple and fresh positive evidence is present. Any identity mismatch, terminal record, superseding Binding, expired decision, or changed tuple requires a new proposal/decision.

### Retract or retire

A terminal cause increments the invalidating generation, makes every dependent bridge fail closed, retracts canonical Bindings/instances, preserves tombstones and cleanup responsibility, and appends events in one local transaction. Hook disable, provider deletion, credential removal, and remote cleanup follow as Effects. Their failure cannot restore local authority.

### Rollback and graduation

Both use the same prepare/CAS/cleanup protocol. Reconciliation can finish an exact submitted Plan or Rollback but cannot rebase a Plan, change equivalence/deviation choices, select another historical target, or make an ineligible historical tuple usable.

## Alarm ownership, retry, and dead letters

The workspace Durable Object has one Cloudflare alarm, already shared by agent keepalive and external-message delivery. All alarm concerns must route through one `scheduleNextWorkspaceAlarm()` coordinator; no subsystem may independently delete or overwrite the alarm. The coordinator chooses the earliest persisted deadline among:

- local lease, receipt, health-evidence, rotation-overlap, and authority deadlines;
- Effect claim timeout or next attempt;
- existing agent keepalive, response-delivery, and retention deadlines.

When an alarm fires, local authority deadlines run first. Session expiry, receipt expiry, health staleness, rotation cutoff, suspension, and Retraction therefore cannot wait for running agents to finish. Bounded external Effect work runs next; message delivery and agent keepalive behavior then proceed. Every concern reschedules through the coordinator on completion.

Retryable Effects use persisted exponential backoff:

```text
delay = min(5 seconds × 2^(attempt - 1), 15 minutes) × stableJitter(effectId, attempt)
stableJitter ∈ [0.75, 1.25]
```

The computed `nextAttemptAt` is stored, so restarts do not reset or randomize the schedule. An adapter may require a larger minimum delay or shorter terminal deadline; it may not request busy retry. Retry-After is honored within a one-hour ceiling when later than the computed delay.

After 12 unsuccessful attempts or 24 hours since the first attempt, whichever occurs first, an Effect moves once to `deadLetter` and emits an Authority Event because visible recovery responsibility changed. Automatic hot retry stops. The exact same Effect may be requeued by an explicit safe retry command or new authenticated provider evidence; requeue does not change its input or claim success.

Dead-lettered creation/preparation leaves no authority active. Dead-lettered cleanup remains rooted on the tombstone or live replacement and visible as `cleanupPending`/`cleanupBlocked` until confirmed. It is never discarded by retention or garbage collection. An Authority Manager may record cleanup abandonment only when the adapter declares that outcome meaningful and the consequence preview is explicit; abandonment records an event and still never restores authority.

Local expiry, invalidation, suspension, and Retraction are not retryable provider Effects and never dead-letter. If their transaction fails, the alarm is retried; bridges independently enforce persisted deadlines and generations meanwhile.

## Health, verification, and caches

Security-relevant facts are not hidden behind generic TTL caches:

| Fact | Canonical owner and invalidation |
| --- | --- |
| Source eligibility | Computed in the workspace transaction from exact lifecycle, origin, Account/grant/Source generations, health evidence, mode, Consumer, and receipt; never stored as a mutable boolean. An in-memory candidate view may be reused only under an exact dependency digest. |
| Credential Health | Latest generation-bound Gatekeeper observation stored by Workspace Authority with report sequence, `observedAt`, and `validUntil`. A stale or mismatched report is ignored. |
| Verification Receipt | Immutable workspace record indexed by its complete verifier/Source/resource/policy/generation tuple and explicit expiry/invalidation. |
| Artifact Approval | Canonical local Approval epoch and evidence hashes; no cache is needed for authority decisions. |
| Consumer authentication | A transient Development Session or Workload Attachment generation snapshot, never a shared or durable authentication cache. |
| Access JWKS | Adapter-owned per issuer, bounded by response freshness and a ten-minute ceiling; one refresh on unknown `kid`, then fail closed. |

For version 1, a healthy Gatekeeper report used by Project authority is valid for at most 15 minutes. Workspace Authority schedules refresh before `validUntil`. When refresh is unavailable or indeterminate, the health fact becomes `unknown` at that persisted deadline:

- new Source resolution, Contract preparation, Session materialization/renewal, and Workload Attachment creation are blocked;
- an already-issued Development environment or Workload Attachment may continue only until the earlier of its existing deadline or 15 minutes after `validUntil`;
- no lease, Attachment, health fact, or receipt is extended while health is unknown;
- active durable Bindings are not rewritten or redirected merely because the provider is unreachable.

This bounded continuation distinguishes lack of evidence from positive credential failure. `attentionRequired`, exact Account/grant/Source generation mismatch, revocation, or retirement invalidates dependent bridges and suspends/retracts locally immediately with no grace.

A Verification Receipt is valid only to its persisted `expiresAt` and for its complete generation tuple. Version 1 caps receipt lifetime at 15 minutes. Renewal is scheduled at two-thirds of its lifetime, with at least one minute of lead. `verified` may create a new immutable receipt; `indeterminate` leaves the current receipt untouched until expiry; `denied` invalidates the tuple and suspends affected verified Bindings immediately. A renewal outcome racing a generation change or replacement is discarded as stale and cannot extend the old receipt.

Development lease renewal is one transaction and succeeds only before current expiry. It rechecks the authenticated developer, build permission, exact Grant/template, Consumer and Binding generations, current health/receipt facts, and immutable tuple. The new expiry is the earliest of `now + 15 minutes`, Grant expiry, policy expiry, each exact receipt expiry, and each healthy Source's bounded continuation deadline (`health.validUntil + 15 minutes`). Renewal cannot start once health is unknown. Exact idempotent replay returns the committed lease generation; a late renewal creates no authority.

Workload Attachments use the same evidence deadline rules and remain capped at 15 minutes. Attachment loss is transport state only. Registration or environment-generation change invalidates the entire attachment environment; it is never hot-patched.

## Consumer Readiness and diagnostics

Consumer Readiness is a stored generation-tagged projection derived in the same transaction as its causes. It contains `requiredReady`, environment generation, exact Binding Set version, and one bounded typed diagnostic per Requirement. It is not a policy input.

- `requiredReady` is true only when every required Requirement has an active eligible Binding to the exact Contract Instance.
- Optional `noCandidate`, `ambiguous`, `verificationRequired`, `pending`, `suspended`, `failed`, or `cleanupBlocked` conditions do not make required readiness false; they remain visible and the optional binding is absent.
- A missing, ambiguous, stale, expired, suspended, retracted, or pre-CAS required Binding makes readiness false. No environment capability is returned, so Consumers never receive a mixed required set.
- Preparation or replacement pending leaves an eligible current Binding and readiness intact. If no eligible current Binding exists, the Requirement is pending/blocked.
- `cleanupPending` after successful CAS does not make the new Binding unready. Diagnostics name the active generation and the predecessor cleanup responsibility.
- Unknown provider/verification state never becomes an optional fallback or redirects another binding.

Any readiness or Binding-generation change increments the Consumer environment generation and invalidates all existing environment stubs. Event emission occurs only when the durable projection changes.

## Restart and race recovery

On Durable Object restart, persisted queue markers, Effects, claim deadlines, leases, receipts, rotations, Operations, and Bindings are sufficient to resume. In-memory caches, timers, callbacks, and Authority Sessions are dispensable.

Required recovery cases are:

- **crash before external call:** the unclaimed Effect remains pending and is claimed normally;
- **crash during/after external call:** claim expiry produces `outcomeUnknown`; probe or idempotent replay under the same Effect ID establishes the result;
- **crash after preparation:** the prepared instance is found by decision/Effect indexes; current preconditions permit CAS, otherwise it is marked obsolete and cleaned;
- **crash after Binding CAS:** the CAS transaction already created predecessor cleanup Effects and events, so the new Binding remains active and cleanup resumes;
- **stale expected Binding generation:** publish nothing, preserve the current Binding, mark the prepared result obsolete, and clean it; do not choose another Source or “replan” the human decision;
- **lease/receipt expires while renewal is in flight:** the transaction serialized first wins only if all expected revisions still match; an outcome arriving after expiry cannot revive the old generation;
- **terminal revocation races provider success:** local generation invalidation wins; the remote resource is immediately scheduled for cleanup and never becomes a Binding;
- **duplicate/out-of-order callback:** exact identity/generation plus monotonic report sequence makes it a no-op;
- **workspace alarm fires late:** bridges enforce deadlines synchronously, then the alarm catches durable state and events up without extending authority.

## Observability and API surface

Authority Events record only durable decisions, lifecycle/readiness changes, effect intent, observed outcome, dead-lettering, cleanup responsibility, and explicit abandonment. Attempts that merely update count/backoff are structured operational logs. Logs use typed bounded fields such as operation/effect kind, stable local target ID, attempt, reason code, and timing; they never include credentials, provider payloads, headers, tokens, raw identities, or request/response bodies.

The public `AuthorityApi` exposes bounded Operation, Effect, readiness, and diagnostic views plus exact human retry/abandon commands. It exposes no generic `reconcile()` mutation. Internal adapters submit closed typed outcomes through non-public generation-checked entrypoints. Consumer APIs expose only their current readiness, exact environment generation, binding names/public types, and relevant bounded diagnostics.

## Conformance tests

The implementation is not ready to cut over until deterministic tests cover:

- state/event transaction rollback and no-op passes;
- Effect claim races, expired claims, idempotent replay, probe-before-replay, late outcomes, lane serialization, retry/backoff persistence, and dead-letter/requeue;
- crash points before call, after provider success, after preparation, before/after Binding CAS, and before cleanup outcome;
- stale Binding CAS and cleanup of unreachable prepared instances;
- local-first suspension/Retraction when Gatekeeper/provider cleanup is unavailable;
- health callback duplication/order/generation mismatch and exact 15-minute unknown-state continuation cutoff;
- receipt verified/denied/indeterminate outcomes and renewal/expiry races;
- lease renewal at expiry, delayed alarms, Registration rotation overlap/finalization, and whole-environment invalidation;
- required versus optional readiness, replacement while current remains eligible, and cleanup-pending after activation;
- restart reconstruction using durable state only and coexistence with agent/message alarm concerns;
- absence of raw Source, Account, verifier, provider key, token, or credential data in state, events, diagnostics, and logs.

## Considered options

- Treating reconciliation as a periodic full desired-versus-actual sync was rejected because it would be expensive, blur decision authority, and tempt the system to redirect ambiguous state.
- Using Authority Events as the replay source was rejected because events are an audit projection; canonical current records remain authoritative.
- Holding a storage transaction open across external work was rejected because provider calls are not atomic with Durable Object storage and would make crash outcomes unverifiable.
- Retrying with a new idempotency key was rejected because it can duplicate provider resources and sever causal recovery.
- Automatically abandoning cleanup after a retry budget was rejected because remote residue remains a real responsibility even after local authority is safe.
- Treating `unknown` as immediate credential revocation was rejected because provider unavailability is not positive evidence of compromise; bounded existing sessions may finish, but nothing renews or expands.
- Letting the existing agent keepalive wait run before authority deadlines was rejected because a running agent must not extend leases, receipts, or revoked authority.
- Caching an eligibility boolean was rejected because it would hide the generations and expiring evidence on which the result depends.

## Consequences

Reconciliation is deterministic, crash-safe, and auditable without becoming a second authority system. Local fail-closed behavior is synchronous with canonical generations; provider availability affects cleanup and new issuance, not the truth of committed local revocation.

Implementation must add a coalescing reconciliation queue, extend the existing single-alarm coordinator, implement exact Effect claim/outcome entrypoints and per-adapter retry/probe profiles, store bounded health validity, project Consumer Readiness transactionally, and make every Contract bridge enforce generations and deadlines. These kernel changes should be split by concern and reviewed before Gatekeeper/UI expansion.
