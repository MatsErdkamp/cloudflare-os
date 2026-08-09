---
status: accepted
---

# Agent Tasks are deadline-bounded executions, not Chat sessions

## Context

Chat already persists conversation history and can resume model turns after approval or server
restart. Treating that persistence as reusable authority would let a later message, callback, or model
continuation silently inherit an earlier capability graph. Agent Task Authority instead needs one
auditable execution identity with a wall-clock bound, short fail-closed leases, explicit continuation,
and terminal cleanup independent of Chat retention.

The standing Development Session and Workload Attachment decisions already use 15-minute
generation-checked leases, persisted absolute deadlines, synchronous expiry checks, and fresh
environment snapshots after generation changes. Agent Tasks reuse that security cadence while adding
an immutable task maximum that includes human approval pauses.

## Identity and dispatch

Every execution has a Workspace-issued Agent Task ID and stores:

- its task generation and lifecycle;
- the exact Task Dispatch Decision and approved Task Template version;
- one Effective Workspace Principal ID and generation;
- at most one optional Pre-established Application Scope ID and generation;
- the initiating user-intent, callback, or parent-delegation reference;
- `createdAt`, immutable `absoluteExpiresAt`, current Agent Task Lease generation and expiry;
- current Task Environment generation and Trust Ratchet version;
- parent/child lineage, if any; and
- bounded checkpoint, terminal reason, result, and cleanup references.

A Chat message is provenance, not identity. A new user-authored instruction that asks the Agent
Service to act creates a fresh Agent Task and exact Task Dispatch Decision. An arbitrary follow-up such
as “continue” also creates a fresh task; it may cite prior task results but cannot resume their
authority. The only same-task continuations are closed system transitions for an already nonterminal
task: restart recovery, transport reconnect, a lease renewal, an approval decision tied to that task,
or completion of an already-started synchronous operation. Each rechecks the same dispatch tuple.

A Task Dispatch Decision is per task. It cannot be cached by Chat, Agent Service, Workload, role,
Principal, Template, or Pre-established Application Scope and reused for another task. Idempotent
replay of the exact dispatch operation returns the same task; a changed intent, Template version,
Principal, scope, placement, or request digest creates a new decision and task.

The Effective Workspace Principal reference is a closed union: either the workspace owner profile plus
current ownership generation or one workspace member profile plus current membership generation. The
canonical ownership/membership record is its only source. Authenticated transport is evidence used to
select that record at dispatch; an Agent Service, Workload, Gatekeeper, provider identity, callback
payload, or Chat participant can never substitute for it.

The scope reference is either absent or exactly `{ kind: "workspaceApplication", scopeId,
scopeGeneration }`, naming a canonical Workspace Authority record created by an earlier explicit
authority decision through a supported adapter. That record is only a restriction: it contains no
Principal, membership, Account, Source, or reusable capability and can never widen the Template or
Principal. V1's R2 enforcement path supplies no application-scope adapter, so R2 tasks require the
reference to be absent; a non-absent unsupported scope fails dispatch closed. This preserves the
future seam without introducing the tenant authority model reserved for #43.

Together, task identity/generation, the Effective Workspace Principal reference/generation, and the
optional Pre-established Application Scope reference/generation form one immutable **Task Authority
Correlation**. Schemas carry this value as one tuple rather than copying a loose data clump.

## Duration and leases

One approved Task Template version declares `maximumTaskDuration`. V1 caps it at 24 wall-clock hours.
Dispatch chooses:

```text
absoluteExpiresAt = min(
  dispatchedAt + template.maximumTaskDuration,
  dispatchedAt + 24 hours,
  every earlier decision, Principal, Pre-established Application Scope, and upstream authority deadline
)
```

Time spent running, disconnected, paused for approval, waiting for a child, or awaiting retry all
counts against this immutable deadline. No event, approval, callback, Ratchet transition, checkpoint,
restart, or organization gate can move it later.

For a child task, `absoluteExpiresAt` is additionally no later than its parent's immutable
`absoluteExpiresAt`. No delegation or child Template may extend the parent's remaining lifetime.

An Agent Task Lease lasts at most 15 minutes. While actively running, the Agent Service requests
renewal every five minutes and whenever less than ten minutes remain. Renewal is one Workspace
transaction that succeeds only before current lease expiry and rechecks the exact task, dispatch,
Template Approval, Effective Workspace Principal, optional Pre-established Application Scope, Workload Registration,
Binding, Task Environment, Ratchet, health, receipt, and authority generations. Its new expiry is the
earliest of `now + 15 minutes`, `absoluteExpiresAt`, and every cited deadline. Renewal increments the
lease and Task Environment generations and follows the acknowledged replacement protocol from
ADR 0020; old endpoints fail closed.

Every Binding Enforcement Endpoint and protected-result mediator checks both `leaseExpiresAt` and
`absoluteExpiresAt` against the runtime clock before invocation and release. A delayed alarm or
Workspace restart therefore cannot extend either deadline; the alarm only catches canonical lifecycle
and cleanup records up to the already-effective expiry.

Lease expiry immediately invalidates the Task Environment and moves a still-pre-deadline task to
`suspendedLeaseExpired`. It does not extend or complete the task. The same task may resume only after
fresh eligibility checks and exact environment rematerialization under its unchanged dispatch. The
absolute task expiry is terminal and can never resume.

## Lifecycle

The durable lifecycle is:

```text
dispatching -> running <-> awaitingApproval
                    |  <-> awaitingChild
                    |  -> suspendedLeaseExpired -> running
                    +----> completed | failed | cancelled | expired
```

`dispatching` has no published authority until every required Task Binding is prepared, acknowledged,
and atomically published. `running` owns one current lease and Task Environment generation.
`awaitingApproval`, `awaitingChild`, and `suspendedLeaseExpired` are capability-free pause states: the
current environment, task Bindings, egress mediators, parallel calls, and protected-result release
gates are invalidated before the pause is reported durable. A Task Checkpoint contains only bounded
orchestration data and generation references; it contains no RPC stub, Source, credential, token,
live callback, egress handle, protected observation, or reusable environment.

Resume creates a fresh lease and Task Environment generation and rechecks the complete original
tuple. It never chooses a different Template, Principal, Pre-established Application Scope, Artifact Approval,
Upstream Authority, provider/resource, operation class, recipient, or egress destination. A changed or
revoked cited fact cancels the task with a typed eligibility reason unless its absolute deadline has
already made `expired` authoritative. A still-approved immutable Template version remains the pin
when another version is later created; deprecation and revocation behavior is defined by its own
approval lifecycle in ADR 0022/#25, not by silently switching versions.

## Approval pauses

A runtime Approval Request identifies the exact task, invocation, lease, Task Environment, Binding,
and Ratchet generations plus a `decisionDeadline` no later than `absoluteExpiresAt`. Creating it cannot
extend the task or keep authority live. Before exposing `awaitingApproval`, Workspace Authority
invalidates and acknowledges the current environment and stores a capability-free checkpoint.

Approval releases only authority already present under the same dispatch and current Ratchet. An
accepted decision resumes only while the exact request, task, Template Approval, Principal,
Pre-established Application Scope, and all cited generations remain current. Denial terminally cancels the task with
reason `approvalDenied`. An undecided request at its decision deadline terminally expires the task with
reason `approvalAbandoned`. A late, duplicate, or mismatched decision is recorded as stale evidence
and cannot resume or create authority.

## Restart, resumable work, and retained results

Transport loss and Workspace restart are not task lifecycle transitions. They break all ephemeral
stubs and active model/runtime calls. Before continuing, recovery reads the canonical Agent Task and a
Task Checkpoint, rechecks the absolute deadline and complete dispatch tuple, then creates a fresh lease
and acknowledged Task Environment. A missing, stale, corrupt, or generation-mismatched checkpoint
fails the task closed; recovery never reconstructs authority from Chat messages, process memory,
caches, or Facet existence.

Protected observations remain outside model context until their release generation is acknowledged.
A pause may retain them only in the protected result store under exact task/environment/Ratchet
generations. A resume may adopt such a result only through explicit predecessor lineage after every
new Task Environment endpoint acknowledges its generation and the original result tuple still
matches; otherwise it becomes permanently unreleasable. Completion may retain declassified output,
bounded result metadata, content hashes, and provenance. Cancellation, failure, expiry, or abandoned
approval atomically marks every unreleased protected result permanently unreleasable and roots a
deletion Effect. After deletion, only bounded tombstone metadata—task/result IDs, hashes, sizes,
generations, terminal reason, and cleanup outcome—remains; none may later be released into Chat or a
fresh task. Chat may store the final user-visible output and task reference, never the capability or
release gate.

## Callbacks

A callback completing an operation already started by the current live lease may be accepted only
under its exact task, invocation, Binding, environment, and Ratchet generations. A late callback is
task-neutral evidence until Workspace Authority rechecks those generations; after pause or terminal
state it cannot release a result or resume the task.

A persistent or out-of-band callback never carries Agent Task authority. It records provenance and
requests a fresh callback-origin Agent Task with a fresh Task Dispatch Decision. Dispatch re-resolves
the one Effective Workspace Principal from the callback registration's existing Workspace authority;
if that Principal, registration, Template, or optional Pre-established Application Scope is no longer eligible, no task
is created. Gatekeepers and callback payloads cannot choose a Principal or scope. Any callback
subscription or hook created by an Agent Task expires no later than that task and is disabled during
its terminal transition; it cannot become standing authority. Only an independently approved,
pre-existing standing callback registration may request a later fresh task.

## Parent and child tasks

V1 has no detached children. A parent creates a durable Task Delegation naming one approved child
Template version and an exact requested subset of the parent's current effective authority. Workspace
Authority creates a fresh child Agent Task, Task Dispatch Decision, lease, Bindings, environment, and
Ratchet. The Delegation and child snapshot record the exact parent task, parent Task Environment, and
parent Ratchet generations, the parent's effective-authority digest, and the parent's absolute
deadline. The child keeps the same Effective Workspace Principal and optional Pre-established
Application Scope and receives the intersection of:

1. the child's approved Template ceiling;
2. the parent's current effective post-Ratchet authority;
3. the explicit delegation request; and
4. current provider, resource-owner, organization, and health eligibility.

The child inherits no ambient Binding, callback, egress, cache entry, or stub. It may narrow further
but cannot restore authority removed from its parent. Every child renewal, resume, endpoint snapshot,
invocation, and protected-result release rechecks its recorded parent deadline and lineage. A parent
Task Environment or Ratchet generation change invalidates affected descendants synchronously. A child
may continue only after a lineage-linked replacement proves its authority remains a subset of the
parent's new effective authority and every participating endpoint acknowledges; otherwise it is
cancelled. Parent absolute expiry fails descendants closed from the runtime clock even when the alarm
is late. A child result crosses a generation-checked protected-result mediator and returns data, never
live authority. Parent cancellation, failure, or expiry completes descendant terminal operations
before the parent is reported terminal. Parent completion waits for children or explicitly cancels
them; a child cannot outlive its parent in V1.

## Terminal effects

`completed`, `failed`, `cancelled`, and `expired` are immutable terminal states. Their transition first
persists an exact terminal Invalidation Intent, invalidates every Task Binding endpoint, egress and
result-release gate, obtains complete acknowledgement, and drives each nonterminal descendant through
its own acknowledged terminal operation. Only then does one local Workspace transaction increment the
task/environment generations, retract canonical Task Bindings and egress grants, terminalize pending
Approval Requests and synchronous callback records, store terminal event/result references, and root
Contract Instance/provider cleanup. No RPC, descendant transition, or cleanup call occurs inside that
transaction. A crash can leave a safe over-revoked or partially terminalized tree; reconciliation
finishes the same intents and never restores authority. Cleanup failure cannot restore the task.

| Terminal state | Result and continuation                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `completed`    | Retain only released/declassified output and provenance; any further user intent or callback uses a fresh task.                          |
| `failed`       | Retain bounded failure reason and safe diagnostics; unreleased protected results remain unavailable. Retry is a fresh task and dispatch. |
| `cancelled`    | Record actor/reason, cancel descendants, and reject pending results/callbacks. Cancellation is idempotent.                               |
| `expired`      | Effective at `absoluteExpiresAt` even if the alarm is late; late renewal, approval, callback, or result release is stale.                |

## Principal and scope invariant

Every canonical record, Effect, endpoint snapshot, checkpoint, protected result, callback correlation,
cache key, event, and Agent Activity record carries the same Task Authority Correlation. Missing or
mismatched correlation fails closed. Process memory and caches are accelerators only and can never
supply or change it. Agent Service remains the executing role/profile of its registered Workload; it
is not the task Principal and cannot substitute its own identity. Gatekeeper/provider Observation
Evidence remains task-neutral; the Workspace enforcement adapter wraps it with this correlation and a
reference to the immutable provider evidence rather than modifying the provider record.

## Considered options

- **Use one Chat as the task/session** was rejected because Chat retention and later messages would
  become reusable ambient authority.
- **Keep live Bindings during approval pauses** was rejected because human latency would turn a short
  execution lease into standing authority.
- **Pause the absolute deadline** was rejected because approval or disconnection could extend authority
  without another dispatch decision.
- **Use only the 15-minute execution lease as the absolute lifetime** was rejected because ordinary
  human approval pauses would routinely force a new task; the 24-hour ceiling preserves one bounded
  intent across a workday while every live environment still expires after at most 15 minutes.
- **Allow an unbounded or multi-day approval pause** was rejected because callbacks and unattended
  decisions would become stale standing authority under another name.
- **Let persistent callbacks resume an old task** was rejected because external time and payloads would
  control authority lifetime.
- **Let children share the parent environment** was rejected because inheritance would be ambient,
  unreviewable, and impossible to retract independently.

## Consequences and conformance

Implementation must use fake clocks and injected restart/acknowledgement failures to prove lease and
absolute expiry, approval pause/resume, stale Template/Binding/Principal/scope refusal, callback and
checkpoint replay, descendant lineage invalidation and expiry, no protected-result release after
generation change, and fresh dispatch after every terminal state. The same single Workspace alarm
processes task deadlines before external Effects and agent/message work. Chat migration adds task
references and provenance but no capability field or reusable authority handle.
