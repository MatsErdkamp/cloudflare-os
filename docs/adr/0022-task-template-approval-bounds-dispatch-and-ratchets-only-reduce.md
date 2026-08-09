---
status: accepted
---

# Task Template approval bounds dispatch and Ratchets only reduce

## Context

An approved executable and a role-capable Agent Service are insufficient to authorize a particular
execution. Workspace Authority needs an immutable reviewed ceiling, a per-task eligibility and
placement decision, a generation-complete environment, and a monotonic way to remove authority while
the task runs. These records must extend the canonical Binding Resolution model rather than create a
task-only resolver. They must also keep protected provider results outside model context until every
enforcement participant agrees on the same narrowed generation.

ADRs 0018 through 0021 establish one Workspace aggregate, a materialized Contract Facet as the
Binding Enforcement Endpoint, enforcement-first acknowledged replacement, and deadline-bounded Agent
Tasks. This decision fills the remaining governance, dispatch, Ratchet, protected-result, and evidence
vocabulary required before their integrated specification in ADR 0023/#39.

## Immutable Template governance

A Task Template is a stable lineage identified by `taskTemplateId`. It confers no authority. Every
change creates a complete immutable Task Template Version identified by the lineage and a monotonically
allocated version. A version contains at least:

- every required and optional Task Binding Requirement with a stable requirement ID;
- exact Artifact Approval epoch references for every Contract Artifact that may execute;
- one maximum Effective Authority Envelope for every requirement;
- `maximumTaskDuration`, child-delegation constraints, and whether each requirement may be shared;
- the closed runtime-enforcement profiles that can mediate every declared capability and asynchronous
  shape; and
- Effective Workspace Principal eligibility, optional Pre-established Application Scope constraints,
  Authority Debt production policy, and required organization gates.

Descriptions, defaults, requirement optionality, policy selectors, Artifact Approval epochs, duration,
runtime coverage, declassification rules, and any authority dimension are versioned content. None may
be edited in place. Supersession is an immutable edge from a newer version to its predecessor; it does
not alter or revoke the predecessor.

A Task Template Approval is a separate immutable Workspace decision over one exact version. Its
approval epoch identifies that decision and
records the reviewer, decision time, reviewed comparison/evidence, every exact Artifact Approval epoch,
and the accepted maximum ceiling digest. Artifact Approval establishes that exact code may potentially
execute; Task Template Approval establishes only the maximum combination in which those artifacts may
be used for a task. Neither decision installs a Contract, creates a Binding, selects a Principal, or
authorizes a dispatch.

Approval lifecycle is append-only:

| Transition | New dispatch                                                            | Already-dispatched task                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| superseded | The old epoch remains eligible unless separately deprecated or revoked. | Remains pinned to its exact version and epoch. It never adopts the successor.                                                                                                              |
| deprecated | Refused from the effective deprecation time.                            | May run, resume, and renew only within its existing absolute deadline while every other pinned fact remains eligible; no child may newly cite it.                                          |
| revoked    | Refused immediately.                                                    | Its Task Environments and result gates are synchronously invalidated under ADR 0020 and the task is cancelled; no resume, renewal, child dispatch, or protected-result release is allowed. |

Revocation or ineligibility of a pinned Artifact Approval epoch has the same fail-closed consequence
for every Template Approval and active task that cites it. Deprecation never moves an active task to a
new version, while revocation never waits for its lease or alarm. Approval state is derived from the
immutable approval plus later lifecycle decisions; the original record is not mutated.

## Task Binding Requirements and canonical placement

Each Task Binding Requirement fixes one named capability and its exact Artifact Approval epoch,
Upstream Authority eligibility, one normalized maximum Effective Authority Envelope, runtime
coverage, protected-result treatment, and Authority Debt policy. The Envelope has a closed schema for
the exact provider/resource and Upstream Authority identities, Artifact Approval epoch, operations,
recipients, egress, release classes, sharing, enforcement profile, and maximum expiry. An optional
requirement omitted at dispatch is permanently absent from that Agent Task; adding it later would
increase effective authority and is therefore forbidden.

For placement, one Agent Task acts as one short-lived Task Consumer. This is a role of that task, not
a standing Consumer identity and not another identity for its Agent Service or Workload. Each placed
requirement produces the same records used by standing authority:

1. one canonical immutable Binding Resolution whose requirement reference is exactly the Task
   Template Version and requirement ID and whose placement reference is the Task Dispatch Decision;
2. one fresh Contract Instance over one exact Upstream Authority; and
3. one separately identified, generation-tagged task Binding owned by the Task Consumer.

Every Resolution records the exact Task Consumer, requirement reference, Upstream Authority and
generations, Artifact Approval epoch, Task Dispatch Decision, Contract Instance, shared-state choice,
and expected Binding generation. A task-specific Binding map, resolver, inferred dependency, raw
Provider Source, or `ManagerSourceLoopback` is never authoritative or reachable. Agent Service
Bindings and Workload authority are eligible upstream inputs only through canonical attenuating
Bindings and a fresh Contract Instance; task placement never copies a live stub or grants ambience.

## Dispatch is an exact intersection

A Task Template Approval is a ceiling, not dispatch eligibility. For each new Agent Task,
Workspace Authority creates one immutable Task Dispatch Decision only after resolving the exact
intersection of:

1. the active Task Template Approval and its exact Task Template Version;
2. the dispatch origin's already-resolved current Effective Workspace Principal and the Template's
   Principal-eligibility constraints; authenticated-user evidence is required only for a user-origin
   task, while callback and parent-delegation origins use ADR 0021's canonical standing registration
   or parent correlation and may not select another Principal;
3. the exact registered Workload and one-to-one Agent Service role/profile, including its current
   standing authority;
4. every resource owner's current provider/resource policy and every organization gate;
5. the optional Pre-established Application Scope's current restrictive policy through a supported
   adapter;
6. current Artifact Approval, Upstream Authority, Binding, credential-health, Verification Receipt,
   deadline, and Authority Debt production eligibility; and
7. for a child, the parent task's current post-Ratchet authority and exact Task Delegation.

Any missing, unknown, unsupported, unhealthy, stale, or generation-mismatched required fact fails
dispatch closed. An optional requirement can be omitted only when the version declares it optional;
the omission and diagnostic are recorded. A runtime profile absent from any required enforcement
endpoint fails dispatch; unsupported runtimes cannot host Agent Tasks.

The decision records the Task Authority Correlation, exact Template Approval and Artifact Approval
epochs, Agent Service and Workload Registration generations, eligibility-policy generations, every
Resolution and selected Effective Authority Envelope, initial Ratchet version, immutable absolute
expiry, Authority Debt snapshot, and a digest of the initiating intent. It authorizes only that Task
Consumer and cannot be cached or reused. The initial Task Environment is published atomically only
after every included Contract Instance and every participating Binding Enforcement Endpoint, egress
mediator, runtime adapter, and protected-result mediator installs and acknowledges the same exact
generation snapshot. An omitted optional requirement does not participate; every optional requirement
actually placed does. Failure leaves no partial required environment.

## Task Environment and Trust Ratchet

A Task Environment generation is one immutable manifest of exact task Bindings, Contract Instances,
enforcement endpoint acknowledgements, runtime and egress mediators, release gates, deadlines, Task
Authority Correlation, Trust Ratchet version, and selected Effective Authority Envelopes. Its
effective-authority digest covers the complete normalized Envelopes rather than reconstructing a
different set of dimensions at each comparison.

Let `C` be the approved Template ceiling and `E(n)` the effective authority of Ratchet version `n`.
The invariant is:

```text
E(n + 1) ⊆ E(n) ⊆ C
expiry(n + 1) ≤ expiry(n) ≤ absoluteExpiresAt
removed(n) ⊆ removed(n + 1)
E(n + 1) ∩ removed(n + 1) = ∅
```

A Trust Ratchet Transition may retain an unchanged Binding, retract it, or replace it with one fresh
lineage-linked narrower Binding and Contract Instance. Replacement must preserve the Task Consumer,
Principal, application scope, requirement, provider/resource identity, and Artifact Approval epoch;
its Effective Authority Envelope must be a demonstrable subset of its predecessor; and it must not
weaken an enforcement layer or Authority Debt production condition. It cannot add an omitted
requirement, switch Upstream Authority, introduce any Envelope dimension, extend expiry, restore
removed authority, or exceed either the Template ceiling or parent authority. A change needing any of
those is a fresh Agent Task and dispatch, if eligible.

Every transition uses ADR 0020's enforcement-first replacement protocol:

1. validate the subset proof and persist the proposed transition and permanently removed set;
2. prepare every fresh narrower endpoint and obtain exact next-generation acknowledgement without
   publication;
3. invalidate all old or removed Binding, egress, runtime, callback, iterator, stream, restored-
   capability, and protected-result endpoints and acknowledge invalidation;
4. atomically commit the new canonical Bindings, Ratchet version, Task Environment generation,
   Authority Events, cleanup roots, and transition lineage; and
5. revalidate, acknowledge, and only then publish the complete new environment.

A crash or missing acknowledgement leaves the task safely over-revoked and every protected result
held. Reconciliation continues the same durable intent; it never republishes the predecessor or
computes authority from an endpoint. Parallel calls, late callbacks, old streams/iterators, restored
capabilities, and results carrying an old Binding, environment, lease, or Ratchet generation fail
closed.

## Protected observations and reviewed declassification

Gatekeepers and Contracts produce immutable task-neutral provider Observation Evidence. The Workspace
enforcement adapter stores a Protected Observation wrapper that references that evidence and adds the
Task Authority Correlation, invocation, Task Binding, Task Environment, lease, and Ratchet generations
without modifying the provider record. Content remains outside prompt, model context, Chat, callbacks,
logs, and unprotected caches.

Automatic release is allowed only when the current Template release rule and current post-Ratchet
authority already allow the exact content class and recipient. Reviewed release creates one immutable
Reviewed Declassification Decision identifying the exact content hash, bounded review presentation,
recipient, purpose, Declassification Reviewer, reviewer-policy generation, deadline, and all task
generations. Each Template Version's reviewed-declassification rule is exactly `disabled`,
`workspaceOwner`, or `authorityManager`; it also restricts the eligible content and recipient classes.
The Declassification Reviewer must be an authenticated human resolved from the current canonical
Workspace owner record or a member's current `manageAuthority` permission, as selected by that rule.
The decision pins the matching ownership or membership-and-permission generations. Agent Service, the
executing Workload, model output, provider identity, callback data, and the task's initiating Principal
cannot substitute merely by being involved in the task. The decision changes classification of that
exact data only. It cannot select a Source, create or replace a Binding, change a Template, extend a
task or approval deadline, add a recipient, reverse a Ratchet, or make another result eligible. A
changed byte, recipient, purpose, generation, or deadline requires a new review while the same task
remains eligible.

Whether automatic or reviewed, release occurs only after every participating Binding Enforcement
Endpoint, runtime adapter, egress mediator, callback/stream mediator, and protected-result gate has
acknowledged the current Task Environment and Ratchet generation. An absent endpoint, incomplete
cancellation acknowledgement, stale generation, pause, terminal task, revocation, or timeout blocks
release permanently or until the same live task successfully publishes a fresh narrower generation.
Declassification is conjunctive with every Runtime Approval Decision and organization or resource-
owner release condition configured by the Template, Contract, current Effective Authority Envelope,
or dispatch; it can never satisfy, override, or bypass one of those gates. Every cited policy and
decision generation is rechecked at release.
Runtime Approval Decisions and organization gates may release an operation already present in that
generation; they never satisfy this generation barrier, change the Task Template Version, create or
replace a Binding, extend the task ceiling or expiry, or reverse the Ratchet's removed set.

## Evidence separation

The audit model has three correlated but distinct record families, plus operational logs:

| Record family    | Owner and content                                                                                                                 | Never used as                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Authority Events | Workspace-sequenced facts atomically recording approvals, dispatch, Ratchet/environment commits, release decisions, and lifecycle | provider evidence, runtime telemetry, or authority source of truth   |
| Source Activity  | task-neutral Contract/Gatekeeper evidence of provider action or observation, with provider and Contract attribution               | Workspace decision, Task Authority Correlation, or Agent reasoning   |
| Agent Activity   | Workspace-owned task/runtime/mediator attempts and outcomes with exact Task Authority Correlation and references                  | provider evidence, approval, placement, or authority source of truth |
| operational logs | bounded diagnostic events through the package logger                                                                              | durable audit record, prompt transcript, or protected result         |

Workspace wrappers correlate Source Activity by immutable evidence ID; they do not rewrite it.
Authority Operation ID, Task Authority Correlation, invocation ID, and evidence/result references
join the families without copying protected bodies. Credentials, tokens, prompts, headers,
request/response bodies, and Protected Observation content appear in none of these records or logs.

## Ownership and consequences

Workspace Authority owns Template lineages and versions, Template Approval epochs and lifecycle,
Task Dispatch Decisions, Agent Tasks, canonical Resolutions and task Bindings, Task Environments,
Trust Ratchet state, protected wrappers, declassification decisions, Authority Events, and Agent
Activity. It remains one in-process module within the Workspace aggregate.

Contractors remains the generic task-neutral execution and capability-lifecycle kernel. It accepts an
exact generation snapshot and produces lifecycle/Source Activity evidence but owns no Template,
Principal, dispatch, Binding Resolution, Ratchet, or release policy. Gatekeepers retain credentials,
provider authority, and task-neutral provider evidence. Agent Service remains a role/profile of its
one registered Workload. Chat keeps only history, safe released output, provenance, and task
references.

Implementation and conformance must prove immutable versioning, deprecation and immediate revocation,
exact dispatch intersections, no partial required environment, canonical task Resolution placement,
subset-only Ratchet replacement, permanent non-restoration, endpoint acknowledgement barriers, and
the separation and correlation of all evidence families. Failure injection must cover persistence,
RPC, invalidation, acknowledgement, restart, result release, and cleanup boundaries.
