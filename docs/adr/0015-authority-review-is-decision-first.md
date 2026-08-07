# Authority review is decision-first

Workspace Authority is presented as an operational decision workspace, not as a generic settings form or a resource browser. The default route is a Decision Inbox backed by one exact-decision inspector. Projects, Sources, Artifacts, Consumers, and the event ledger are complementary views over the same durable records; they do not invent parallel actions or state.

This decision was validated with three interactive variants on the throwaway `codex/prototype-authority-review-flow` branch at commit `4b9f7597`: a decision inbox, an authority topology map, and an evidence ledger. The prototype is illustrative and disposable. This ADR is the normative experience contract.

## Information architecture

The workspace-level Authority area has these stable destinations:

- **Decision Inbox**: the default route and the only cross-domain action queue;
- **Projects & Environments**: definitions, immutable Binding Set versions, readiness, and Repository Claims;
- **Accounts & Sources**: account ownership, safe identity fingerprints, Source eligibility, credential health, ambiguity, consent status, and repair;
- **Artifacts**: Artifact Proposals, reproducible Review Bundles, Approval epochs, deprecation, and revocation;
- **Consumers & Bindings**: Development Session Grants/templates/sessions, Workloads/Registrations/rotations, exact assignments, Bindings, graduation, and rollback;
- **Authority Managers**: manager grants and their generations, visible only to the owner;
- **Audit Events**: the ordered workspace event ledger;
- **Owner Control**: epoch rotation and Emergency Retraction, visually and procedurally separated from ordinary authority work.

The initial view answers “what needs a decision or repair?” before asking the manager to navigate the domain hierarchy. Counts come from `AuthoritySnapshot`; opening an item obtains its exact current view. Browsing another area can deep-link back into the same inspector for a decision, operation, effect, or event.

The topology map is a contextual view under Projects & Environments and Consumers & Bindings. It shows Environment → exact Binding Requirements → Consumers, including durable readiness and blockers. It is not a canvas, graph editor, or alternate mutation surface.

The ledger is the dedicated audit view. It is optimized for causal sequence, filtering, and correlation rather than for taking the next action. An event may deep-link to the relevant immutable record or current operation, but historical facts are never rendered as editable state.

## Decision Inbox

Each row represents one human decision, blocked decision, or explicit recovery choice. Background retries that need no judgment remain visible on their owning Operation or Effect but do not become fake approvals.

A row contains:

- exact domain kind and requested action;
- durable state, never an inferred spinner;
- Project, Environment, Binding Set/version, Requirement/version, and Consumer where applicable;
- binding name, required/optional status, Authority Mode, and whether fallback is prohibited;
- proposing actor and Authority Operation;
- concise blocker or consequence;
- evidence freshness and expected-generation summary.

The queue groups related steps under one Authority Operation without collapsing them. For example, “approve this Artifact and install it for this Consumer” may use one confirmation screen, but its summary explicitly lists two durable decisions. Confirmation executes two typed commands with distinct step keys, request digests, records, and event sequences. Partial success is shown truthfully and resumed through the Operation.

Managers can filter by durable state, Project/Environment, decision kind, Consumer, and proposer. Sorting prioritizes required-readiness blockers, stale decisions, repair-required ambiguity, and owner-recovery conditions before optional proposals. The client does not manufacture urgency from timestamps.

## Exact-decision inspector

Every action surface opens the same inspector, inline on wide layouts and as a full route or drawer on narrow layouts. It displays before action:

1. the exact placement or authority tuple, including stable IDs, immutable versions, revisions, generations, hashes, expected Binding generation, and no-fallback semantics;
2. the proposing actor, current manager session generation, workspace authority epoch, Operation ID, and step key;
3. candidate Sources and why each is eligible, ineligible, ambiguous, denied, or indeterminate;
4. safe Account/Resource Identity fingerprints, ownership, credential health, verification receipt metadata, and cleanup status without exposing capabilities or secrets;
5. Review Bundle identity, Artifact hash, comparison hash, baseline, generator/toolchain, policy snapshot, reproducibility result, and all required comparison sections;
6. Consumer-specific effects, readiness changes, shared-state selection, predecessor/replacement lineage, and cleanup responsibility;
7. every hidden compare-and-swap precondition that will be committed;
8. the distinct durable records and events produced by confirmation.

Comparison sections are Original source, emitted executable, public interface, Source declaration, dependencies, toolchain/build recipe, and origin/authorship. A section may summarize bounded display patches, but the inspector preserves exact old/new hashes and provides guarded access to the complete evidence. Repository metadata is labeled provenance rather than authority.

Actions use domain verbs such as **Approve Artifact**, **Install for development**, **Choose Source**, **Rotate registration**, **Activate graduation**, **Rollback**, **Reject**, or **Retract**. There is no generic Save button. Destructive and authority-reducing actions use a consequence preview and exact scope.

## Source choice and personal consent

The manager sees candidate facts and makes an explicit Source selection; the system never guesses or falls back. Zero candidates is unsatisfied, one candidate still requires the recorded decision, and multiple candidates are ambiguous until selected.

Selecting a personal Source does not grant consent. The inspector instead creates or shows the exact opaque consent request, then displays `awaiting user`, `granted`, `denied`, `revoked`, or `expired`. Only the named user acts in their personal consent surface. The manager cannot choose the user's provider account, click consent on their behalf, or see its capability.

Workspace Account connection and reconnect are separate flows. The browser may follow a Gatekeeper OAuth attempt, while the resulting Account capability returns directly to core. Reconnect shows same-identity proof or a typed identity mismatch; it never silently replaces a Source.

Health and identity are separate. A matching Account/Resource fingerprint can be unhealthy; a healthy credential does not prove identity. Repair views preserve this distinction and show whether the next step is reconnect, reverify, reselect, reapprove, or retire.

## Artifact approval and installation

Artifact review is Consumer-independent and Installation is Consumer-specific. The UI may stage them together for convenience only when both exact command inputs are visible. The confirmation summary names both records and warns that an Approval can commit while an Installation becomes stale or blocked.

Approval state includes proposal, reproducibility, active epoch, deprecation, revocation, and evidence availability. Installation state includes exact Consumer/Environment/Requirement, chosen Source/mode, shared-state decision, prepared instance, Binding compare-and-swap, predecessor Retraction, and cleanup.

The UI never describes a repository commit, generated bundle, currently running Contract, or legacy possession as approval. Missing original/build evidence is a blocker with an explicit clean-build/review repair path.

## Development Sessions, Workloads, graduation, and rollback

Development views separate Grant, immutable Placement Template, leased Session, and materialized Consumer decisions. Grant approval does not imply an active Session. A template shows every pinned Approval, Source, mode, verifier policy, shared-state choice, binding name, and cited generation. Session expiry and grant revocation are distinct states and actions.

Workload views separate Workload identity, Registration, authenticated attachment, environment assignment, rotation, and provider cleanup. Rotation is shown as durable phases: next subject prepared, credential proved, local Registration generation committed, Binding activation committed, old subject cleanup pending or complete. Once local authority commits, cleanup failure remains visible but cannot visually imply rollback to the predecessor.

Graduation is a reviewed plan, not a wizard that relabels a Gadget. The plan view shows the captured snapshot digest, every requirement item, equivalence or reviewed deviation, blocked legacy evidence, target Consumers, preparation, per-target activation, lineage, and coexistence with the source Gadget. `configured` and `operational` are distinct.

Rollback starts from one historical Binding Resolution or Graduation Lineage target. The preview shows which historical tuple is being restored and which current requirements must be reintroduced. It always makes a fresh Installation Decision and instance. Ineligible history produces a specific blocker rather than a best-effort fallback.

## Durable state language

State labels describe persisted facts:

- `draft`, `reviewable`, `awaitingConsent`, `ambiguous`, `blocked`, and `stale` before a decision;
- `decided`, `effectPending`, `prepared`, `ready`, `active`, `cleanupPending`, `failed`, `aborted`, and `terminal` after or around execution;
- domain-specific lifecycle labels where the underlying record defines them.

A stale result replaces the actionable confirmation with a conflict explanation and refresh/review action. The client cannot silently carry a Source choice or approval across changed preconditions.

`cleanupPending` says which local authority is already current and which party retains cleanup responsibility. Retry is available only when the API exposes a safe exact retry. Abandon is shown only for an explicit human decision supported by the domain command.

Transport loss shows “result unknown” and offers Operation lookup or exact idempotent replay. It never renders success or failure from the disconnect itself.

## Audit and legacy records

Audit is ordered by workspace sequence; timestamps are secondary display metadata. Pages show a high-water mark and deduplicate subscription delivery by sequence. Each event exposes typed actor/causation, Operation, subject, outcome, generations, and safe evidence references.

Source Actions and operational retry logs are linked evidence, not Authority Events, and are labeled separately. Legacy baselines preserve unknown actor, time, provider identity, or provenance as unknown. The UI never reconstructs a fictional event history.

The event ledger follows the workspace lifecycle and is not advertised as a post-deletion compliance archive. Export or external archival would require a separate product and retention decision.

## Owner controls

Authority Manager grants and revocation appear only through the owner capability. A manager can see their own session context but cannot discover or operate the grant editor.

Workspace authority epoch rotation and Emergency Retraction are separate owner-only flows:

- rotation invalidates administration sessions and undecided work but does not remove committed placements;
- Emergency Retraction previews an exact scope, removes local authority first, and leaves provider cleanup visible.

They cannot share a confirmation button, success message, or ambiguous “reset authority” label.

## Considered options

- A resource-first settings hierarchy was rejected as the default because cross-domain blockers and multi-record operations become hidden behind implementation categories.
- A topology map as the primary workspace was rejected because spatial position cannot communicate causal order, exact evidence, or the next required human decision.
- An event ledger as the primary workspace was rejected because audit history is append-only evidence, not a mutation model.
- Separate inspectors for Artifacts, Sources, Workloads, and graduation were rejected because they would drift on tuple, evidence, generation, stale, and operation semantics.
- Optimistic progress spinners were rejected because crash recovery depends on durable record and Effect states.
- Combining Source selection with personal consent was rejected because the actors and authority boundaries are different.

## Consequences

The first implementation slice must deliver the shared inspector and durable state vocabulary before adding every browse surface. The minimum coherent route is Decision Inbox → exact inspector → typed confirmation → Operation/result recovery, with deep links to evidence and current records. Project topology and the event ledger then reuse those components as contextual and audit views.

Frontend state is derived from bounded `AuthorityApi` snapshots, queries, Operations, and event sequences. It never caches a Source capability, infers authority from route access, calls Gatekeepers directly, or treats RPC disconnection as a domain result. RPC stubs are wrapped before React state storage and disposed on replacement, unmount, revocation, and reconnect.
