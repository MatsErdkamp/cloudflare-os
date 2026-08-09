# Graduation translates authority without moving it

Graduation captures one exact Gadget authority snapshot and translates every visible binding into an explicitly reviewed Project requirement and fresh Consumer placement. It never relabels the Gadget, moves or mutates its Contract Instances, copies implicit state, trusts repository metadata, or reconstructs missing history. The Gadget and Project can coexist and diverge after activation; immutable Graduation Lineage explains their relationship.

## What graduation creates

A Graduation Plan proposes, with authority-issued stable IDs:

- one new or existing Project and at least one named Environment;
- one immutable Binding Set version containing one Binding Requirement for every captured Gadget binding;
- optional attributed Repository Claims, which remain non-authoritative provenance;
- one or more explicit targets: stable Workloads plus Workload Registrations, and/or named developers plus Development Session Grants and Placement Templates;
- Artifact Proposals/Approvals, Source/Authority Mode selections, verification policy, Installation Decisions, Contract Instances, and Bindings needed by each target;
- immutable lineage from each source Gadget binding to every resulting requirement and placement.

Code export, repository creation, build/deploy automation, and a Workload's provider deployment are separate effects. A repository or deployed Worker can be referenced by a claim or Registration, but neither creates the Project or selects authority.

The Plan has two independent outcomes. `configured` means the Project, Environment, Binding Set, requirements, and at least one target Registration or Development Session Grant are approved. `operational` means at least one actual Consumer has atomically activated every required Binding. A development-only Project can be configured before its first leased Session; a Workload target becomes operational only after its Registration generation has authenticated and its environment is ready.

## Capturing the Gadget

Graduation can capture only a non-provisional Gadget with no pending binding edges or Contract installation transition. The user must first accept or revert pending chat changes. The capture transaction records:

- Gadget identity and revision;
- a sorted authority snapshot of every visible binding name and target;
- each Contract's stable or legacy ID, Artifact hash, public/source type hashes, Source/Gatekeeper reference, shared-state key, lifecycle, and known generations;
- legacy provenance flags and a canonical snapshot digest;
- the current Gadget code snapshot hash as provenance only.

The binding/Contract digest is an activation precondition. An authority-relevant Gadget binding, Contract, Source, or generation change before activation makes affected items stale and requires an explicit rebase/review. A code-only change produces a provenance warning but cannot redirect authority. After activation, later Gadget changes do not alter or stale the Project.

Submitted Plan items are immutable. A rebase creates a new Plan revision and item-set digest. Decisions whose entire normalized input tuple remains byte-identical may be cited; changed items require new decisions. Stable IDs allocated to an abandoned revision are tombstoned and never reused.

## Translating each binding

Every captured binding produces exactly one Requirement draft; no binding disappears merely because it is hard to translate. Each item is classified `equivalent`, `reviewedDeviation`, or `blocked`.

An Authority Manager explicitly decides:

- unique binding name and required or optional readiness;
- exact Artifact Approval epoch;
- one Source and its Account/grant/Source generations;
- one non-fallback Authority Mode;
- verifier identity/policy where required;
- shared-state selection;
- target Consumers or Development Session Grant;
- exact Binding Set and Requirement versions.

The source Gadget's existing name, Artifact, Source, and shared-state key are suggestions and lineage, not decisions. Existing use cannot reveal whether a binding was intended to be required, whether a personal connection may serve a Project, or whether shared state may be reused.

An item is `equivalent` only when the reviewed binding name, public type, Artifact Approval, Provider Resource Identity, Source authority, Authority Mode, and shared-state choice match the captured effective tuple. Any intentional difference is recorded field-by-field as a `reviewedDeviation`; it is never described as equivalent. A blocked item remains present in the Binding Set with typed diagnostics. Optional blocked items need not prevent Consumer readiness, but they do not gain a fallback.

### Artifact evidence

A workspace Artifact Approval may be reused because approval is Consumer-independent only when its exact Artifact, reproducible Review Bundle, Review Comparison, baseline, generator, policy snapshot, and approval epoch are present, active, and match the captured Artifact. Every target placement still receives a fresh Installation Decision.

A legacy Contract with no original-source/build evidence remains valid in its Gadget but cannot seed Project approval. Recovered authoring source must enter the trusted clean-build/review flow and produce a verified bundle. The legacy bundled executable or chat text may be cited as provenance but cannot be relabeled as original source. If source cannot be recovered and reviewed, the Requirement stays blocked.

### Source and mode

The selected Source must have exact Provider Account and Resource Identities and current Account/grant/Source generations. A legacy Gatekeeper display name, URL, creation specification, callback, or past observer success proves none of these. Reconnect may upgrade lineage only after exact same-identity comparison; mismatch creates a new Source path.

A Workload cannot inherit a Gadget owner's personal connection. Personal mode is available only to a Development Session for the same named user under a current Personal Source Grant. A Workload target must use an explicitly reviewed shared Source, or verified mode with a separate service verifier. Ambiguity blocks selection; zero candidates is unsatisfied; neither condition changes mode.

### State

Per-instance Contract facet state is always fresh and is never copied. The reviewed shared-state choice is either `fresh` with a new authority-owned namespace or `reuseExact` with one existing shared-state reference whose Artifact semantics and access consequences were reviewed. Reusing a Gadget namespace deliberately couples the old and new instances and is displayed as a deviation/risk. It does not transfer ownership, and retiring the Gadget does not delete a namespace still rooted by Project instances.

Graduation has no generic state-cloning primitive. A future state migration must be a separately reviewed Contract/action protocol with its own idempotency and audit semantics.

## Consumer-specific authority

A Workload target receives a fresh Installation Decision and Contract Instance for every Requirement. Its Workload Registration is a separate decision/effect and must prove the active adapter subject/generation before environment activation.

A Development Session does not exist when its Grant is approved. Its immutable Development Placement Template pins the exact Approval, Source, mode, verifier policy, binding name, shared-state choice, and cited generations for each Requirement. When a leased Session is created, Workspace Authority materializes fresh Consumer-specific Installation Decisions and instances from that template, recording the original Authority Manager, permission/Grant generation, new Session, and causation sequence. The system makes no new selection. Expired receipts are reverified; any other mismatch blocks materialization and requires a new template decision.

## Preparation and activation

Definitions and decisions are durable before capability preparation. Every external or multi-step action has an item-scoped idempotency key under the Graduation Authority Operation. Contract Artifacts and evidence are published first; Source/verification state is checked; then each Contract Instance is created off-binding with a fresh stable Instance ID and facet generation. The existing create-and-bind path must be split for this flow.

Prepared instances cannot be reached by a Consumer and cannot run hooks. They carry Plan, Item, Source, Approval, Installation Decision, target Consumer, shared-state, and predecessor lineage. Preparation may retry or be cleaned without changing the source Gadget or current target bindings.

Activation is atomic per target Consumer, not across unrelated Consumers. One Durable Object transaction rechecks:

- Plan and source snapshot digests;
- manager/consent/Grant, Registration, Consumer, Account, Source, Approval, verification, and prepared-instance generations;
- exact Environment, Binding Set, Requirement, and Installation Decision versions;
- readiness of every required item;
- expected generation and absence/current target of every named Binding.

The transaction assigns the exact Binding Set version, publishes every ready Contract Binding, records immutable Resolutions/Lineage, changes Consumer readiness, and appends the ordered events. Required items are all-or-nothing for that Consumer. Ready optional items may publish; unavailable optional items remain explicit diagnostics. A stale compare-and-swap changes nothing and schedules unused prepared instances for cleanup.

Different target Consumers may activate independently. The overall Plan reports partial progress rather than claiming global atomicity. Aborting an unactivated target cleans only its prepared instances/effects. Once a target activates, removing it requires ordinary Retraction or Rollback; a Plan-level abort cannot erase committed authority.

The source Gadget and its bindings are never changed or retracted by activation. A later user decision may retire the Gadget through its normal lifecycle, but successful Graduation does not imply that decision.

## Crash and failure recovery

The Plan state machine is `draft → submitted → preparing → configured → operational`, with orthogonal per-item/target states `blocked`, `prepared`, `ready`, `active`, `stale`, `cleanupPending`, `aborted`, and `failed`. State names describe observed durable facts, not optimistic progress.

Each build, evidence publication, Source upgrade, verifier call, Workload credential provisioning, instance preparation, activation, hook disable, Retraction, and cleanup has a persisted intent and idempotency key. A crash leaves pending/unknown work. Reconciliation verifies the external result or retries under the same operation; it never fabricates success or repeats a human decision.

Before activation, failure leaves current target Bindings and all Gadget state untouched. After activation, the new Binding is authoritative even if predecessor or provider cleanup fails; cleanup responsibility stays visible and retries cannot switch authority back. Evidence and shared-state roots remain retained while referenced by a Plan, decision, live instance, tombstone, or Authority Event.

## Later divergence

Graduation is a one-time translation, not synchronization. The Gadget, Project definitions, Workloads, Development Session Grants, Artifacts, Sources, and Bindings evolve independently after activation. Lineage remains frozen at the snapshot and activation sequences. A later Gadget change can inspire a new proposal but cannot update the Project automatically.

Likewise, a Project replacement never mutates the Gadget. Displaying a shared origin or similar code is provenance only and confers no authority.

## Rollback

Rollback names one historical Binding Resolution or Graduation Lineage target. It restores the exact historical Artifact Approval, Source, Authority Mode, Requirement semantics, and shared-state selection; changing any member is an ordinary replacement, not Rollback.

Workspace Authority first verifies that the historical Approval remains active with complete evidence, the Source and all origin generations remain eligible, the required verifier can issue a current receipt, and the shared-state reference still exists. If the historical Requirement is not in the Consumer's current Binding Set, the manager creates and assigns a new Binding Set version that explicitly reintroduces it. Revoked approval, retired Source, missing state, legacy evidence gaps, or ambiguous identity blocks Rollback.

Rollback always obtains a fresh Installation Decision and prepares a new Contract Instance off-binding. It never reuses a tombstone, facet, old capability, old verification receipt, or per-instance state. The activation transaction compare-and-swaps the expected current Binding generation to the new instance, records `predecessor = current instance` and `rollbackTo = historical target`, then locally retracts the predecessor. Failure before the swap leaves the current instance active. A stale swap cleans the prepared instance and replans. Failure after the swap leaves Rollback active with predecessor cleanup pending.

External actions already performed by a prior Contract are historical facts and are not undone by Rollback. Source Action Logs and Authority Events remain append-only.

## Events and lineage

One Graduation or Rollback has one stable Authority Operation, but it does not collapse actors or decisions. Personal consent, Artifact Approval, Development Session Grant/template approval, Installation Decision, Workload Registration, instance preparation, Binding activation, predecessor Retraction, and cleanup each retain their typed event and real actor or system causation.

Graduation Lineage records source Gadget/binding/Contract IDs, legacy provenance and snapshot digest; target Project/Environment/Binding Set/Requirement; target Consumer/Grant, Resolution, Instance and Binding; exact hashes; and activation sequence. Missing historical actor, time, provider identity, source, or review evidence stays absent. A canonical digest links legacy records without manufacturing a history.

## Considered options

- Relabeling the Gadget as a Project was rejected because it would mutate Consumer identity and entangle personal and organizational authority.
- Rebinding a live Gadget Contract to a Project was rejected because a Contract Instance has one immutable Source/Consumer placement and existing facet state.
- Treating current possession as Artifact Approval, personal consent, or Source identity was rejected because legacy records lack the required evidence.
- Activating bindings one by one was rejected for required requirements because a Consumer could observe a partially privileged, falsely ready environment.
- Copying per-instance state was rejected because no generic mechanism can prove semantic compatibility or exactly-once transfer.
- Automatically retiring the Gadget after cutover was rejected because Graduation creates coexistence and lineage, not ownership transfer.
- Reusing a tombstoned instance for Rollback was rejected because it would erase the new decision, generations, and intervening history.

## Consequences

Graduation can be resumed after crashes and can truthfully explain exact equivalence, deliberate deviations, and blockers. It preserves the live Gadget while producing independently governed Project Consumers and fresh capabilities.

Implementation must add immutable Plan/Item/Lineage records, split Contract preparation from Binding publication, materialize Development Placement Templates, activate a target in one local transaction, and expose explicit recovery/cleanup state. No step may use the existing immediate create-and-bind helper as an approximation.

## Extended Authority amendment (ADR 0023)

References to Source Action Logs mean preserved historical provider activity. New provider evidence is
Source Activity and remains distinct from Authority Events, Agent Activity, and operational logs.
Graduation remains a standing-only translation and cannot seed an Agent Task, Task Template, or Task
Dispatch Decision without their independent current approvals.

Rollback replacement ordering is also refined by ADR 0020: prepare and acknowledge the exact fresh
replacement, persist Invalidation Intent, invalidate and acknowledge the predecessor, then atomically
commit the redirect and predecessor terminal generation at the Revocation Commit Point. Only after
canonical revalidation and fresh acknowledgement may the replacement publish. A crash after old-
generation invalidation leaves safe over-revocation, never an active replacement beside a still-live
predecessor; reconciliation resumes the same intent and cleanup.
