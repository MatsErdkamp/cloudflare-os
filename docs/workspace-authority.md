# Authority Operating System implementation specification

Status: Accepted architecture gate

Target branch: `codex/workspace-authority`

This is the normative integrated delivery contract for standing Workspace Authority and bounded Agent
Task Authority. ADRs 0001–0024 remain the decision record. The explicit scope corrections in
“Superseded standing-only statements” below control where an older ADR used an unqualified standing-
only statement. A mechanism selected by the #22 or #23 prototype evidence controls over an earlier
provisional sequence.

`CONTEXT-MAP.md`, `packages/workshop-backend/CONTEXT.md`, and
`packages/contractors/CONTEXT.md` are the normative ubiquitous-language glossaries. For extended
delivery, ADRs 0023–0024 and this specification control mechanics and scope over ADRs 0018–0022, then the
amended standing ADRs 0001–0017; the glossaries control canonical term meaning. Any remaining
glossary/specification conflict is a documentation defect that must be reconciled before
implementation, not permission to choose the broader reading.

## Outcome

One Workspace is the organizational boundary and sole transactional authority aggregate. It owns
durable standing authority and the authority of every bounded Agent Task. Project is a stable cross-
repository software scope inside the Workspace; Repository Claims are untrusted discovery and
provenance metadata.

Standing Consumers receive deliberately installed capabilities. An Agent Task receives one exact,
deadline-bounded Task Environment under an approved immutable Task Template Version and may only
preserve or reduce that authority through the Trust Ratchet. Both paths use the same Artifact
Approval, Binding Resolution, Contract Instance, Binding, enforcement, revocation, event, Effect, and
reconciliation vocabulary. They differ through closed requirement and placement discriminants, not
parallel stores or resolvers.

The programme is complete only when canonical standing and Agent Task conformance passes, the one
current Contract executable format is enforced, the one-way compatibility cutover is complete where
authorized, unsupported task runtimes remain disabled, and root lint, test, and build pass.

## Scope and non-goals

In scope:

- Workspace-owned authority state, revocable administration, and one deep in-process authority module;
- Personal and Workspace Accounts, identity-bound Sources, Credential Health, and Authority Debt;
- Artifact Approval, Task Template Approval, Installation Decision, Task Dispatch Decision, runtime
  Approval Request/Decision, and organization gates as distinct decisions or records;
- Projects, Environments, Binding Sets, standing Consumers, Agent Services, and Task Consumers;
- canonical Binding Resolution, separate Contract Instance and Binding records, acknowledged Binding
  Enforcement Endpoints, and enforcement-first revocation;
- immutable Task Template Versions, Agent Task lifecycle, protected results, reviewed declassification,
  Task Environments, and subset-only Trust Ratchet transitions;
- Gatekeeper authority protocol, reproducible Review Bundles, durable Effects, Authority Events,
  Source Activity, Agent Activity, and operational diagnostics; and
- expand–migrate–contract compatibility, Graduation, and forward-only rollback.

V1 non-goals:

- external application Principals, tenant memberships, tenant-owned Accounts/Sources, or public-
  application per-user provider connections;
- treating a Project, Repository Claim, Chat, Agent Service, provider identity, or application scope
  as a Principal or another authority aggregate;
- task enforcement on any runtime or asynchronous capability shape absent from the explicit coverage
  matrix; unsupported paths fail dispatch closed;
- runtime adapters beyond the R2 MVP paths selected by #35/#40;
- a Grant Review Loop that mutates a live task; future proposals always produce a new immutable
  Template Version and affect only fresh dispatch; or
- reinterpreting unsupported pre-launch Contract data under the current harness or inferring missing
  identity/approval evidence.

An optional Pre-established Application Scope is only a prior Workspace-owned restriction through a
supported adapter. It never supplies a Principal, Account, Source, tenant membership, or authority.
R2 V1 has no such adapter and requires it to be absent.

## Ownership and trusted computing boundaries

| Component                                             | Owns                                                                                                                                                            | Must not own                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Workspace Durable Object / Workspace Authority module | canonical standing/task records, decisions, generations, environments, events, operations, effects, migration, reconciliation                                   | provider credentials, Contract execution, a parallel Manager/Task aggregate, external RPC inside storage transactions |
| Agent Task Authority                                  | one task's materialized ceiling, Task Bindings, Task Environment, protected-result correlation, Trust Ratchet                                                   | reusable standing authority, another durable store, provider evidence mutation                                        |
| Contractors / Contract Runtime                        | generic Contract Artifact execution, Contract Instance capability-graph membrane, generation snapshot install/ack/invalidation, task-neutral lifecycle evidence | Workspace, Template, Principal, dispatch, placement, Ratchet, or declassification policy                              |
| Gatekeeper                                            | credentials, provider authority, provider identity/resource lifecycle, task-neutral provider evidence                                                           | Consumer/task selection, ambience, Workspace decisions, Task Authority Correlation                                    |
| User Durable Object                                   | Personal Accounts and explicit workspace consent                                                                                                                | Workspace/task policy or shared placement                                                                             |
| Review Bundle builder                                 | reproducible bounded evidence over content-addressed inputs                                                                                                     | approval, placement, Sources, Bindings, or capabilities                                                               |
| R2 evidence store                                     | immutable Review Bundles, comparisons, and attestations                                                                                                         | mutable authority state, authority decisions, or an inferred protected-result release policy                          |
| Workspace protected-result service                    | opaque content references, exact protected bytes/buffer lifecycle, generation release gate, retention/tombstone state, and deletion Effects                     | authority creation, provider evidence mutation, model-visible release before complete acknowledgement                 |
| opaque protected-byte backing store                   | opaque bytes addressed by Workspace-owned content reference and retention command                                                                               | release eligibility, task-correlation policy, authority records, or independent retention decisions                   |
| Agent Service                                         | role/profile keyed one-to-one to one registered Workload                                                                                                        | independent identity, Account, Source, Binding Set, standing authority, or Principal status                           |
| Workshop frontend / Chat                              | decision presentation; history, safe output, provenance, task references                                                                                        | authority inference, reusable capability, live Task Environment                                                       |
| runtime/workload adapter                              | authentication and complete enforcement for one declared coverage profile                                                                                       | authority creation, unsupported fallbacks, repository/deployment claims as identity                                   |

The selected application authority TCB is the Workspace publication/invalidation lifecycle plus the
Contract Instance Facet membrane and each participating runtime/egress/result mediator. Gatekeepers
remain provider boundaries. The browser still enters through an Overseer-owned Cap'n Web transport,
but Overseer is not method-aware on ordinary Contract dispatch.

## Security invariants

1. Workspace is the only transactional aggregate; authority writes use its existing typed storage and
   one narrow command/query module.
2. Only the owner or a member holding the current `manageAuthority` generation may administer
   authority. Build/use membership remains orthogonal.
3. Credentials remain in Gatekeepers. Logs, events, evidence wrappers, RPCs, prompts, and diagnostics
   contain no credentials, tokens, headers, request/response bodies, or protected content.
4. Provider Account/Resource identities are stable provider-issued tuples. Names, URLs, repositories,
   branches, deployment labels, and Repository Claims are never authority.
5. Artifact Approval, Task Template Approval, Installation Decision, Task Dispatch Decision, runtime
   Approval Request/Decision, and organization gates remain distinct. Contract possession preapproves
   only actions exposed by that installed Contract. Later gates may release already-present authority
   but never create, broaden, extend, or restore it.
6. Binding Resolution is one immutable placement model. Its requirement reference is exactly an
   Environment Binding Requirement version or a Task Binding Requirement in one Task Template
   Version. Its placement reference is exactly an Installation Decision or Task Dispatch Decision.
7. Every Resolution records the exact Consumer, requirement, Upstream Authority and generations,
   Artifact Approval epoch, placement decision, separate Contract Instance, shared-state choice, and
   expected Binding generation. A Binding is a separate generation-tagged possession record.
8. No canonical standing or task path exposes a raw Provider Source or `ManagerSourceLoopback`.
   Upstream Authority always enters a fresh attenuating Contract Instance through canonical placement.
9. Every derived capability is bound to the complete acknowledged generation snapshot. Stale roots,
   derived capabilities, callbacks, parallel calls, streams/iterators, restored capabilities, old
   Binding generations, and old Task Environment/Ratchet generations fail closed.
10. Revocation is enforcement-first. Old endpoints and release gates acknowledge invalidation before
    the Revocation Commit Point changes canonical authority and roots cleanup. Cleanup failure never
    restores authority.
11. Required standing or task environments publish as one complete acknowledged generation. Every
    included optional endpoint participates equally; omitted optional requirements remain absent and
    cannot be added to a live task.
12. Agent Task absolute expiry never moves later; live leases last at most 15 minutes. Pause states and
    Task Checkpoints are capability-free. Unsupported runtimes cannot dispatch a task.
13. For Template ceiling `C` and effective task authority `E(n)`, `E(n+1) ⊆ E(n) ⊆ C`, expiry is
    non-increasing, and the removed set is monotonic. Replacement may only create a lineage-linked
    narrower Binding and fresh Contract Instance.
14. Protected Observations remain outside model context until every participating enforcement and
    release endpoint acknowledges the current environment/Ratchet generation. Reviewed
    declassification changes exact data classification only and is conjunctive with all other gates.
15. Provider Observation Evidence and Source Activity remain task-neutral. Workspace-owned wrappers
    add Task Authority Correlation without rewriting provider evidence.
16. Authority Events, Source Activity, Agent Activity, and structured operational logs are distinct.
    Authority Events commit atomically with local authority state; none of the other three is a source
    of authority truth.
17. Authority Debt always retains provider-native/effective scope, enforcement layer, revocation
    granularity, risk, exception owner, production eligibility, and remediation. Task narrowing never
    hides broader provider-native debt.

## Canonical records and discriminants

Stable Workspace-issued IDs identify all durable records; authority-bearing changes advance monotonic
generations, immutable policy/evidence uses explicit versions or epochs, and lifecycle-bearing records
retain bounded tombstones.

| Concern             | Canonical records                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| administration      | Authority Grant, Authority Session snapshot, Authority Proposal, Authority Operation, Authority Effect                                                                   |
| provider provenance | Workspace Account, Personal Source Grant, Source Record, Credential Health, Verification Receipt, Authority Debt                                                         |
| software scope      | Project, Repository Claim, Environment, Binding Set Version, Workload, Workload Registration, Agent Service Profile                                                      |
| review              | Contract Artifact, Contract Review Bundle, Review Comparison, Build Attestation, Artifact Approval epoch                                                                 |
| standing placement  | Environment Binding Requirement, Installation Decision, Binding Resolution, Contract Instance, Binding, Consumer Readiness                                               |
| task governance     | Task Template, Task Template Version, Task Template Approval and lifecycle decisions, Task Binding Requirement                                                           |
| task execution      | Task Dispatch Decision, Agent Task/Task Consumer, Task Binding, Task Environment, Agent Task Lease, Task Checkpoint, Task Delegation                                     |
| narrowing/release   | Effective Authority Envelope, Trust Ratchet Transition/removed set, Protected Observation wrapper, Reviewed Declassification Decision, runtime Approval Request/Decision |
| audit/recovery      | Authority Event, Source Activity reference, Agent Activity, Invalidation Intent, Revocation Commit Point, cleanup tombstone                                              |

A standing Consumer is a Gadget, Development Session, or Workload. It is explicitly assigned one
Environment Binding Set Version. A task-scoped Agent Task acts as a Task Consumer and cites one
approved Task Template Version. This is one discriminated `Consumer` reference, not a standing identity
for the task.

Standing requirements use one explicit `personal`, `shared`, or `verified` Authority Mode and never
fall back. Task requirements use one normalized maximum Effective Authority Envelope. For both paths,
candidate discovery is not authority; the immutable placement decision selects exact Upstream
Authority. Contract Instance execution and Binding possession remain separate throughout replacement,
retraction, migration, and audit.

## Runtime publication, invocation, and revocation

The Binding Enforcement Endpoint is the materialized Contract Instance Facet. Before publishing any
Binding, Workspace Authority:

1. derives the complete canonical identity/generation snapshot and digest;
2. materializes the exact Facet rather than retaining a lazy `Fetcher`;
3. obtains durable installation acknowledgement from the Facet and all participating mediators;
4. revalidates every canonical generation after acknowledgement; and
5. publishes a supervisor-owned, non-method-aware transport capability.

Cap'n Web promise pipelining remains supported. Every RPC stub is disposed when no longer used, but
disposal is resource management and never proof of revocation. Raw transferred authority-bearing or
protected streams are unsupported. A supported asynchronous shape must mediate each result/chunk and
prove invalidation acknowledgement; otherwise dispatch or return fails closed.

ADR 0025/#35 fixes one closed runtime inventory covering Code Mode/Dynamic Workers, host tools, web fetch, MCP,
browser automation, sandbox/container execution, subprocesses, raw TCP, callbacks, and webhooks. Each
path is classified exactly as mediated, disabled, or unsupported, with named enforcement and
acknowledgement endpoints. #40's R2 V1 slice enables only Code Mode/Dynamic Workers, the
`executeCode`, metadata-only `describeBinding`, and control-only `giveUp` host tools, and the R2
Source path. It sets `globalOutbound: null`; web fetch and every other
uninventoried or uncovered path remain unavailable. Protected results stay in the generation-bound
buffer until the complete current environment is acknowledged.

Replacement and retraction use ADR 0020:

1. validate the exact operation and prepare/acknowledge any fresh replacement without publication;
2. persist a generation-bound Invalidation Intent;
3. invalidate every old endpoint and protected-result release gate and obtain acknowledgement;
4. atomically commit canonical state, Authority Events, predecessor lineage, and cleanup roots at the
   Revocation Commit Point; and
5. revalidate, acknowledge, and publish any fresh replacement, then run cleanup Effects.

A crash may leave safe invalidation, over-revocation, publication, or cleanup lag. Durable intent and
canonical generations are sufficient to resume; caches, callbacks, Facet existence, and process
memory are not. A provider action that crossed its Upstream Authority boundary remains task-neutral
Source Activity evidence, but a result completing after invalidation acknowledgement is quarantined
and cannot be released.

## Standing authority flow

An Authority Manager approves an exact Contract Artifact/Review Bundle, then separately makes an
Installation Decision for one exact standing Consumer requirement and Upstream Authority. Workspace
Authority creates the canonical Resolution, fresh Contract Instance, and Binding through the
acknowledged protocol. Required Bindings publish as one environment generation; optional failures stay
explicit. Reconciliation preserves an exact eligible Resolution or reduces authority. Any expansion,
redirect, different Source/mode/artifact/Consumer, or historical rollback is a fresh reviewed decision
and fresh instance.

Development Sessions are 15-minute leased Consumers under one immutable grant/placement template.
Workloads are stable Consumers authenticated by current Workload Registration evidence and opened
through transient attachments. Transport/deployment/repository metadata never supplies Project,
Environment, Binding Set, or permission. Graduation translates a Gadget snapshot into independent
Project decisions and fresh instances; it never moves identity or authority.

## Agent Task authority flow

Every user intent, persistent callback, or parent delegation creates a fresh Agent Task and Task
Dispatch Decision. Chat stores provenance and task references only. The Effective Workspace Principal
is exactly the current owner record or one current member record; an optional supported application
scope only narrows it. Agent Service is the executing role/profile of one Workload, not the Principal.

A Task Template is a stable lineage. Every change creates a complete immutable Version. A Task
Template Approval pins that Version and exact Artifact Approval epochs as a maximum ceiling but does
not make any Principal eligible. Supersession leaves the old approval unchanged, deprecation blocks
new dispatch while bounded active tasks may finish, and revocation immediately invalidates/cancels all
active tasks pinned to it.

Dispatch materializes the exact intersection of Template Approval, Effective Workspace Principal
eligibility, Agent Service Workload authority, resource-owner/organization policy, optional supported
application-scope policy, health/receipt/Authority Debt production eligibility, and parent delegation.
Each included Task Binding Requirement produces the same canonical Resolution, fresh Contract
Instance, and separate Binding used by standing placement. No ambience or copied live stub is allowed.

Agent Tasks have an immutable absolute deadline of at most 24 wall-clock hours and live leases of at
most 15 minutes. Approval wait, child wait, disconnect, and retry count toward the deadline. Pausing
invalidates and acknowledges the complete environment before storing a capability-free checkpoint.
Resume creates a fresh lease/environment generation after exact revalidation; absolute expiry is
terminal. Persistent callbacks request a fresh task. V1 children are independently dispatched,
materialized, and continuously bounded by parent correlation, current post-Ratchet authority, and the
parent deadline; no detached child or environment inheritance exists.

The Trust Ratchet operates on one normalized Effective Authority Envelope. A transition may preserve,
retract, or publish a lineage-linked demonstrably narrower Binding. It cannot add an omitted
requirement, switch provider/resource/Upstream Authority/Artifact Approval, introduce an operation,
recipient or egress dimension, weaken enforcement/debt eligibility, extend expiry, restore a removed
dimension, exceed the Template ceiling, or exceed current parent authority. It uses the same
enforcement-first acknowledged replacement sequence as standing authority.

Protected provider evidence stays task-neutral. A Workspace Protected Observation wrapper adds exact
task, Principal/scope, invocation, Binding, lease, environment, and Ratchet correlation. Automatic or
reviewed release requires the exact current recipient/content class within the post-Ratchet Envelope,
every configured runtime/organization/resource-owner gate, and acknowledgement from every
participating endpoint. Reviewed Declassification Decisions are made only by the current owner or
current Authority Manager selected by the Template's closed reviewer rule and pin their authority
generation. They cannot change authority.

Terminal task transitions persist intent, invalidate/acknowledge every Binding, egress, runtime,
callback, descendant, and result gate, then commit local terminal state/events/cleanup roots in one
Workspace transaction. Unreleased results become permanently unreleasable and are deleted by Effect;
only bounded tombstone metadata remains.

## Evidence and observability

| Family          | Content                                                                                                                       | Authority relationship                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Authority Event | bounded Workspace-sequenced approval, placement, lifecycle, environment/Ratchet, release, and cleanup facts                   | atomic audit projection of canonical state, never source of truth |
| Source Activity | task-neutral Contract/Gatekeeper provider action or observation evidence                                                      | referenced by immutable ID; never rewritten with task authority   |
| Agent Activity  | Workspace-owned runtime, invocation, mediator, acknowledgement, and protected-result outcomes with Task Authority Correlation | evidence, never approval or placement                             |
| operational log | typed bounded diagnostic event through `@gadgets/backend-utils/logger`                                                        | no durable authority or audit guarantee                           |

Authority Operation ID, Task Authority Correlation, invocation ID, and evidence/result references join
the families. Bodies, prompts, credentials, headers, tokens, and Protected Observations appear in none.

## Storage, compatibility, and rollout

The existing Workspace Durable Object and typed-storage mechanism remain the only database. The deep
authority module hides schema and command/query mechanics. New canonical Artifact Approval,
Installation Decision, Task Dispatch Decision, Binding Resolution, Contract Instance, Binding,
runtime Approval, Task, Environment, Ratchet, event, and Effect records are additive before cutover.
Legacy `ContractRecord` and Gadget binding maps are not extended into a second authority model.

Migration follows `legacy -> backfilling -> readyToCutover -> active`. Before cutover, bounded staging
and transactional deltas are disposable. One local transaction validates the complete digest and
publishes canonical records. Afterwards, canonical collections are the only authority; legacy APIs and
Gadget binding maps are projections/compatibility facades, and old writers fail closed. There is no
permanent dual read/write model and no switch back to legacy semantics. Contracts use the sole
current content-addressed executable format from ADR 0024; unsupported pre-launch formats fail closed
and cannot authorize Project, Workload, or Agent Task placement.

## Package and interface plan

| Package                            | Review-sized responsibility                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contractors`             | one current authoring/runtime interface, generic lifecycle membrane and conformance, exact executable hashes                                                          |
| `packages/workshop-shared`         | fully doc-commented real RPC/domain types and validators; no hand-written mirrors or unsafe bridge casts                                                           |
| `packages/workshop-backend`        | one deep authority module, canonical storage/commands/queries, publication/revocation, task adapter, protected-result service/mediator interface, migration facade |
| `packages/gatekeeper-r2`           | task-neutral authority protocol identity/health/resource/evidence/lifecycle implementation                                                                         |
| `packages/contract-review-builder` | isolated reproducible evidence production with no authority capability                                                                                             |
| `packages/contractors-cli`         | authenticated leased-development transport and local proxy, no durable authority                                                                                   |
| `packages/workshop-frontend`       | decision/review/inventory/diagnostic/task operations surfaces; dispose RPC stubs and wrap stubs in React state objects                                             |
| runtime adapters                   | closed enforcement coverage profiles; absent coverage disables Agent Task dispatch                                                                                 |

RPC interfaces are derived from the real Cap'n Web API and use promise pipelining where it removes
round trips. Every stub is disposed. Generated files change only through their generators.

## Dependency-ordered implementation sequence

The issue DAG, not list order, controls execution. A ticket begins only after every blocker closes.
The integrated gate #39 closes before #31 or #34.

1. **Decisions and prototypes:** #21 -> #22 -> #23; #21 -> #24 -> #25; then this #39 gate.
2. **Independent foundations:** #21 -> #26 -> #27 and #21 -> #28 -> #29. Use the sole current
   content-addressed Contract format and extract one in-process Workspace module before cutover.
3. **Provider/review foundations:** #26 + #29 -> #30; #26 + #29 -> #32.
4. **Standing proof:** #22 + #23 + #27 + #30 + #39 -> #31; then #31 + #32 -> #33.
5. **Task records and runtime policy:** #25 + #31 + #33 + #39 -> #34; #25 + #34 -> #35; #35 -> #40.
6. **Ratchet and operations:** #23 + #27 + #40 -> #36; #34 + #36 + #40 -> #41.
7. **MVP convergence:** #33 + #36 + #41 -> #37; then #37 -> #38 and #37 -> #42.
8. **Post-MVP:** #39 -> #43; #35 + #37 -> #44. Split #44 into dependency-linked runtime tracer
   bullets before implementation if one adapter exceeds a reviewable checkpoint.

Commits remain focused by issue and separate kernel/shared, provider, UI, and compatibility concerns.
Expand–migrate–contract preserves usable behavior at each checkpoint.

## Conformance matrix

Every checkpoint runs its affected tests and package type/build checks. Security-sensitive adapters
inject every named persistence, RPC, invalidation, acknowledgement, restart, release, and cleanup
failure. The final gate runs root `pnpm lint`, `pnpm test`, and `pnpm build`.

| Proof                           | Required cases                                                                                                                                                                                                                                                        | Owning tickets          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| artifact identity and authoring ABI | exact current Artifact, authoring declaration, harness, module-set, and runtime-profile hashes; creation metadata excluded; compiler returns candidate+inputs+trace, never approval; host-produced closed immutable generation-aware invocation evidence | #26 |
| capability lifecycle            | arbitrary supported graph retraction; cancellation, callbacks, streams/iterators, restoration, composition, and cleanup                                                                                                                                               | #27, #31, #36, #37      |
| reproducible review             | hermetic candidate/verifier double build; content addressing; exact inputs/recipe/toolchain/trace; mismatch, network, shared-state, and approval fabrication fail closed                                                                                              | #32                     |
| canonical storage/cutover       | state/event atomicity; idempotent operations; stable IDs/indexes; separate Resolution/Instance/Binding; one atomic cutover; no dual authority                                                                                                                         | #28, #29, #31, #38      |
| provider protocol/debt/evidence | credential opacity; stable identities/generations; requested/resolved/returned scope and bytes/provenance/provider IDs; distinct observation/action staging; health/receipt expiry; mismatch, stale callback, reconnect, and raw Account/Source escape fail closed    | #30, #31, #37           |
| publication/revocation          | materialization before publish; exact snapshot ack; stale/lazy/disposed/restored roots; failure before/after every intent, invalidation, commit, publication, restart, cleanup                                                                                        | #22, #23, #27, #31      |
| standing resolution             | no fallback; exact modes/decision; required atomic readiness; optional absence; replacement/rollback; stale generation and in-flight mutation fail closed                                                                                                             | #29, #31, #33           |
| task lifecycle/dispatch         | fresh task per intent/callback; exact Principal/Workload/policy/health/debt intersection; deadlines/leases/pauses/checkpoints/children; unsupported runtime refusal                                                                                                   | #24, #25, #34, #35, #40 |
| Ratchet/environment             | formal subset and permanent removed set; fresh lineage-linked Binding; old Binding/environment/Ratchet rejection; missing ack/cancel blocks release                                                                                                                   | #25, #36                |
| asynchronous escape             | parallel calls, callbacks, raw/mediated streams, iterators, restored capabilities, stale results, expired leases and late approvals all fail closed                                                                                                                   | #27, #35, #36, #37      |
| protected results               | task-neutral provider evidence; exact Workspace wrapper; every participant acks new generation; pause/terminal/revocation block; declassification cannot bypass gates                                                                                                 | #25, #35, #36, #40, #41 |
| audit/operations                | Authority/Source/Agent/log separation; bounded correlation/no bodies; cancellation records durable/local outcome and never infers it from transport; keyboard-operable review; missing-ack, stale-parallel-work, reconciliation, dead-letter, and cleanup diagnostics | #29, #37, #41           |
| end-to-end R2                   | canonical standing slice, Development/Workload migration, exact task dispatch, protected release, Ratchet replacement, restart and cleanup recovery                                                                                                                   | #31, #33, #37, #40      |
| compatibility                   | historical Gadget semantics; one current Contract executable format; #28 rollout guard and bounded telemetry proving no new `ManagerSourceLoopback`/raw-source use; compatibility projection; raw legacy paths unreachable; retirement                                  | #26, #28, #29, #31, #38 |
| future Template proposals       | Agent Activity is evidence only; review creates a new immutable Template Version/Approval path and never mutates or widens an active task                                                                                                                             | #42                     |
| external tenant authority       | external Principal/tenant/account/source ownership, cross-tenant isolation, and aggregate protocol are explicit and cannot reinterpret Repository Claims or application scope                                                                                         | #43                     |
| additional runtime adapters     | one tracer bullet per adapter; complete no-ambient-egress, coverage, stale-generation, invalidation/ack, protected-result, restart, and cleanup proof before enablement                                                                                               | #44                     |

## Operational completion criteria

- every in-scope issue acceptance criterion and conformance row has committed evidence;
- canonical records and normative docs agree; no premature ready label or unresolved blocker remains;
- all new/migrated active workspaces use one canonical store and one Binding Resolution model;
- no standing/task path reaches a raw Provider Source or `ManagerSourceLoopback`;
- R2 passes standing and Agent Task end-to-end proofs; unsupported runtime coverage stays disabled;
- revocation, expiry, pause, cancellation, and Ratchet replacement fail closed synchronously, while
  durable Effects converge cleanup without resurrection;
- protected results cannot enter model context before complete generation acknowledgement;
- Authority Debt and all three evidence families remain visible without sensitive bodies; and
- root `pnpm lint`, `pnpm test`, and `pnpm build` succeed, with independently pre-existing failures
  distinguished by reproducible evidence.

## Superseded standing-only statements

This table is an explicit normative qualification, not a silent rewrite.

| Earlier statement                                                                                                  | Integrated rule                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| issue #1's early Project/Manager plan terminology described Project as the authority aggregate                     | Workspace is the sole aggregate; Project is cross-repository software scope. ADR 0001's Workspace Durable Object ownership remains controlling.                                                                                                           |
| ADR 0006 said every Consumer has an Environment Binding Set and every Resolution uses Source/Installation Decision | That applies to standing Consumers. Task Consumers use Task Binding Requirements, exact Upstream Authority, and Task Dispatch Decisions through the same Resolution model.                                                                                |
| ADR 0007 named only standing event families and a Source Action Log                                                | ADR 0022 adds Template/task/dispatch/environment/Ratchet/declassification events; Source Activity is the canonical task-neutral family, with legacy Source Action Log as a compatibility projection. Agent Activity and operational logs remain separate. |
| ADR 0008/older flow text could read as Gatekeepers creating/managing Contract Instances                            | Gatekeepers manage provider authority and task-neutral lifecycle operations. Contractors owns Contract execution; Workspace Authority owns canonical placement/publication/revocation.                                                                    |
| ADR 0010 said existing Contract records are extended in place                                                      | Legacy records remain byte/behavior-compatible projections. New canonical Contract Instance and Binding records are separate and become sole authority at one atomic cutover.                                                                             |
| ADR 0014 exposed standing administration and described Emergency Retraction local-transaction-first                | The same revocable Authority Session gains bounded task commands/queries and never returns raw authority; Emergency Retraction follows ADR 0020's acknowledged enforcement-first commit point.                                                            |
| ADR 0016's original canonical-first/CAS-first retraction wording                                                   | ADR 0020's acknowledged enforcement-first protocol and Revocation Commit Point control; the later ADR 0016 amendment already records this supersession.                                                                                                   |
| ADR 0017's ten-step standing rollout                                                                               | The dependency-ordered sequence and conformance matrix above replace that provisional ordering while preserving its one-way cutover and current-only Contract rule.                                                                                       |

## Decision traceability

| Decision                                                                                                                 | ADR                                                                                   | Programme ticket |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------- |
| standing Workspace ownership through compatibility rollout                                                               | [0001–0017](./adr)                                                                    | #1–#19           |
| one Workspace aggregate, ownership split, canonical standing/task Resolution, approval taxonomy, Authority Debt          | [0018](./adr/0018-standing-and-task-authority-share-one-workspace-aggregate.md)       | #21              |
| materialized generation-acknowledged Contract Facet enforcement                                                          | [0019](./adr/0019-binding-enforcement-lives-at-the-contract-execution-facet.md)       | #22              |
| enforcement-first revocation, acknowledged invalidation, durable restart                                                 | [0020](./adr/0020-revocation-invalidates-enforcement-before-canonical-commit.md)      | #23              |
| task identity, Principal/scope correlation, deadline/lease/pause/callback/child/terminal lifecycle                       | [0021](./adr/0021-agent-tasks-are-deadline-bounded-executions-not-chat-sessions.md)   | #24              |
| immutable Template governance, exact dispatch, canonical task placement, Ratchet, protected release, evidence separation | [0022](./adr/0022-task-template-approval-bounds-dispatch-and-ratchets-only-reduce.md) | #25              |
| integrated delivery contract and conformance matrix                                                                      | this specification                                                                    | #39              |

Prototype branches `codex/prototype-binding-enforcement-topologies` and
`codex/prototype-crash-safe-local-revocation` are decision evidence, not production architecture.
