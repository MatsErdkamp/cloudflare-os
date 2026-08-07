# Workspace Authority implementation specification

Status: Ready for implementation

Target branch: `codex/workspace-authority`

This specification is the implementation handoff for Workspace Authority. The accepted ADRs in [`docs/adr`](./adr) are normative; this document integrates them into one delivery plan. If a summary here conflicts with an ADR, the ADR controls.

## Outcome

A workspace owner can delegate authority administration without delegating build access. Authority Managers can connect or receive consent to Sources, approve immutable Contract artifacts, install them for explicitly identified Consumers, and audit or retract every resulting capability. Gadgets keep working during migration. Projects add named Environments, leased Development Sessions, authenticated Workloads, and deliberate Graduation from a Gadget without guessing identity or moving authority between Consumers.

The implementation is complete only when the canonical model, compatibility cutover, first R2 vertical slice, development proof, Cloudflare workload proof, Graduation flow, reconciliation, audit trail, and decision-first UI pass the gates below.

## Scope and non-goals

In scope:

- workspace-owned authority state and revocable administration;
- Personal and Workspace Accounts, identity-bound Sources, and credential health;
- separate Artifact Approval and Installation Decisions;
- Gadgets, Development Sessions, and Workloads as Consumers;
- Projects, Environments, Binding Sets, exact resolution, and canonical Bindings;
- Gatekeeper authority protocol, reproducible Review Bundles, durable effects, and audit events;
- compatibility migration, rollout controls, Graduation, and replacement rollback.

Not in scope:

- moving provider credentials into the workspace DO;
- treating repository, branch, deployment, email, or display names as authority;
- automatic fallback among `personal`, `shared`, and `verified` modes;
- a general policy language, arbitrary provider rollout, or cross-account Cloudflare identity in the first slice;
- rewriting old Contract artifacts or granting builders authority-management rights during migration.

## Ownership and trust boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Workspace Durable Object | authority records, decisions, generations, events, operations, effects, migration, reconciliation | provider credentials or user consent records |
| User Durable Object | Personal Accounts and explicit workspace consent | workspace policy or shared placement |
| Gatekeeper | credentials, provider identity/resource resolution, health, verification, capability minting | ambience, workspace decisions, Consumer selection |
| Contract Runtime | immutable artifact execution, instance state, approval context | Source selection or authority policy |
| Review Bundle builder | reproducible candidate/verifier builds and bounded evidence | approval or installation decisions |
| R2 | content-addressed Review Bundle evidence | mutable authority state |
| Workshop frontend | decision and diagnostic presentation | independent authority inference |
| Development CLI | authenticated transport and local proxy lifecycle | durable authority or locally selected placement |
| Workload adapter | authentication of provider evidence | Project, Environment, Binding Set, or permission claims |

The workspace DO remains the sole authority boundary. No parallel Manager DO is introduced. `Overseer` delegates to one deep `authority/` module whose public surface hides storage layout and transition mechanics.

## Security invariants

1. Only the owner or a member with the current `manageAuthority` generation can open an Authority Session or make authority decisions.
2. Build/use membership and `manageAuthority` are orthogonal. Revocation invalidates existing sessions immediately by generation and authority epoch.
3. Credentials stay inside Gatekeepers. Workspace records contain opaque capabilities, stable provider identities, lifecycle generations, and non-secret health only.
4. Account identity and Source resource identity are provider-issued stable tuples; names, URLs, repository metadata, and deployment labels are descriptive only.
5. Artifact Approval answers “may this code be used?” Installation Decision answers “may this approved artifact use this exact Source for this exact Consumer requirement?” Neither implies the other.
6. Each Binding Requirement has exactly one mode: `personal`, `shared`, or `verified`. Resolution never guesses, falls back, or silently substitutes.
7. Every authority expansion is an explicit manager decision. Reconciliation may reduce or finish committed authority, never select new authority.
8. Authority state and its audit events commit atomically inside one idempotent Authority Operation. External work is represented by durable, idempotent Effects.
9. Every derived capability is generation-bound. A mismatch fails closed even before asynchronous cleanup completes.
10. Required bindings are exposed atomically as one ready environment; optional failures remain explicit diagnostics.
11. A Development Session is a leased Consumer, and a Workload is a stable Consumer authenticated through a registration. Transport identity is evidence, not authority.
12. Graduation creates fresh Project instances with lineage. Rollback creates a fresh replacement; neither moves or resurrects an existing instance.

## Canonical model

Stable workspace-issued IDs identify Projects, Environments, Binding Sets and requirements, Consumers, Sources, approvals, decisions, resolutions, instances, and Bindings. Provider Account and Resource identities are separate stable tuples. Records carry lifecycle state, monotonic security generations, attribution, timestamps, and causal operation IDs.

A Project owns Environments. An Environment owns immutable versions of a Binding Set. A Consumer is explicitly assigned one version. Each Binding Requirement pins one Artifact Approval epoch, name, optionality, mode, and eligibility constraints. A Binding Resolution records the exact Source, verification result when required, Installation Decision, Contract Instance, and expected Binding generation. A Consumer is ready only when all required resolutions are active and eligible.

Sources are derived from either a workspace-owned Account or a Personal Source Grant. Credential health is generation-bound evidence, not ownership or permission. A provider identity conflict pauses eligibility for manager review; it is never merged by display similarity.

All mutations go through `AuthorityStore.mutate(operationKey, actor, transition)`. The transaction checks generations and invariants, writes canonical records, assigns workspace event sequence numbers, records effects, and stores the idempotent result. RPC retries return the prior result. Effect execution uses deterministic provider keys and records attempts without changing the already-committed decision.

## Capability graph

`AuthenticatedApi` exposes only entry capabilities:

- `openAuthority()` returns a revocable Authority Session for the owner or current Authority Manager;
- proposal APIs let builders submit immutable proposals and inspect their own status without decision power;
- personal-consent APIs remain user-scoped;
- development APIs let a named developer redeem an exact current Development Session Grant;
- workload attachment is exposed only through the internal workload entrypoint, not a browser/member API.

The Authority Session groups read models, proposals, decisions, account/source administration, Projects, environments, bindings, events, reconciliation diagnostics, Graduation, and rollback. Every call revalidates its session generation/epoch at the authority boundary. All exported `workshop-shared` members receive doc comments and derive RPC types from the real API rather than mirrored hand-written interfaces and casts.

## Gatekeeper and evidence protocols

Gatekeepers add a versioned authority session that can:

- describe a credential generation and stable Provider Account Identity;
- enumerate or resolve stable Provider Resource Identities without exposing credentials;
- derive a workspace Source capability from a Workspace Account or exact Personal Source Grant;
- report bounded credential health;
- independently verify an exact resource for `verified` mode and return an expiring Verification Receipt;
- prepare, activate, deactivate, and destroy a Contract Instance idempotently using deterministic operation keys.

Capabilities and receipts are bound to vendor, issuer, subject/resource key, credential generation, protocol version, and expiry where applicable. Unknown versions fail closed. R2 is the first conforming Gatekeeper. Other Gatekeepers retain their legacy paths until separately enabled.

A Review Bundle is content-addressed evidence over the artifact, normalized build inputs, toolchain/recipe identity, source material, and candidate/verifier outputs. A new internal `contract-review-builder` Worker runs candidate and verifier builds in separate fresh network-disabled isolates with no shared mutable filesystem or cache. It accepts only content-addressed inputs and returns a bounded attestation; it has no Workspace Authority capability. R2 stores the bundle by digest before an approval may cite it.

Existing Artifact hashes and R2 keys remain normative. Canonical blob, Review Bundle, Review Comparison, staging, and reference-ledger namespaces are additive. Conditional writes must verify an existing digest on collision. Staging expires, while garbage collection deletes only content proven unreachable from a complete reference root; an absent or zero root is never permission to collect.

## End-to-end flows

### Authority and Sources

The owner grants `manageAuthority` to a named member. That member opens a generation-bound session. A Workspace Account is created through a Gatekeeper, or a user grants one exact personal resource to the workspace. The Gatekeeper reports stable identity and health; the workspace records provenance and a Source generation. Consent/account/credential revocation immediately makes dependent Sources and Bindings ineligible and enqueues cleanup effects.

### Approval, placement, and installation

A builder proposes an artifact and reproducible build inputs. The builder service produces and stores a Review Bundle. A manager approves its exact digest and epoch. Separately, a manager publishes a Binding Set and chooses the exact eligible Source for each requirement under its declared mode. The resolver records one immutable choice or a typed failure; it never falls back. The workspace commits the Installation Decision and Effects, the Gatekeeper creates the Contract Instance idempotently, and only then does the workspace publish the canonical Binding generation and recompute readiness.

### Development

A manager issues a revocable Development Session Grant for one developer, Project, Environment, and exact Binding Set version, including an immutable placement template. The CLI uses browser-approved login, stores its refresh credential in the OS credential store, and redeems the grant. The workspace mints a 15-minute Consumer lease; the CLI exposes generated types and transparently proxies only its returned capabilities. Renewal requires the same live grant/template generations. Expiry invalidates the Consumer synchronously and receives priority in the shared workspace alarm before agent/message work. Disconnect cleanup is best effort; generation checks enforce the deadline. The first proof edits against R2 locally and demonstrates renew, revoke, expiry, reconnect, terminal retraction, and cleanup recovery.

### Workload

The deployment registers one adapter-authenticated issuer/subject tuple to one stable Workload. The same-account Cloudflare adapter trusts a non-public named Service Binding entrypoint plus a closed-schema deployment-time authenticated `ctx.props`; it emits bounded freshness and assurance evidence. Matching a live registration opens a 15-minute transient attachment at one immutable generation snapshot. Subject rotation prepares a random next subject, permits at most 15 minutes of current/next overlap during binding redeployment, then explicitly finalizes and invalidates old props locally. The attachment resolves the Workload's explicit Environment/Binding Set and exposes no partial required environment. The runtime does not claim to attest deploy principal, script version, repository, route, or branch. Access service tokens are reserved for a later cross-account adapter with explicit lifecycle ownership, strict JWT/JWKS validation, create-before-destroy rotation, and bearer-compromise UX.

### Graduation and rollback

Graduation snapshots a Gadget's exact live bindings and creates an immutable plan mapping each to proposed Project, Environment, requirement, Source/mode, approval, and fresh installation. Managers approve its independent decisions. Activation creates new Project-owned instances and lineage while leaving the Gadget unchanged. Partial preparation is not visible as a ready Project Consumer. Rollback verifies a historical tuple is still eligible, creates a new replacement instance, and records both its predecessor and historical target.

## Reconciliation and failure recovery

Local authority commits before external effects. A workspace alarm processes, in order: authority deadlines (lease/receipt/health/rotation expiry), due authority effects, then existing agent/message work. Each effect has a deterministic idempotency key, desired generation, retry classification, next-attempt time, and bounded diagnostics. Per-target lanes serialize conflicting work. Retry starts at 5 seconds, caps at 15 minutes, uses stable jitter, and dead-letters after 12 attempts or 24 hours. Dead-lettered cleanup remains rooted. Provider calls use prepare/activate/deactivate/destroy semantics where available. Retries cannot recreate authority after retraction because every callback rechecks canonical generation and desired state.

Reconciliation compares canonical facts with effects and reported provider state. It may retry, finish activation, reduce readiness, deactivate stale instances, and surface operator action. It cannot choose a Source, change mode, approve an artifact, or make a new installation decision. Project credential health is valid for at most 15 minutes. Unknown blocks new resolution, renewal, and attachment; existing sessions stop at their prior deadline or no later than 15 minutes after health validity. Positive failure, mismatch, revocation, and retirement invalidate locally at once. Verification Receipts last at most 15 minutes and renew at two-thirds lifetime; an indeterminate result may preserve but never extend an unexpired receipt, while denial suspends immediately. Poisoned or exhausted effects remain visible and do not block unrelated work. Audit events describe committed authority transitions; operational attempts remain effect diagnostics.

## Decision-first UI

The UI has four principal views: proposal queue, decision detail, live authority inventory, and diagnostics/history. Decision detail presents actor, Consumer, Project/Environment, artifact and Review Bundle evidence, exact Source identity/provenance/health, mode-specific verification, binding changes, state sharing, expiry, and consequences before the action control. Expansion and reduction are visually distinct. Typed conflicts, stale generations, unresolved identity, missing evidence, ineligible Sources, and effect failures are actionable states rather than generic errors.

Builders can submit and track proposals but never see manager-only controls. Personal consent remains with the account owner. The minimum slice must be fully keyboard operable, preserve focus across RPC refreshes, announce asynchronous outcomes, avoid color-only status, and keep destructive/retraction actions explicit. Prototype commit `4b9f75974883d307dc6642865861152734a5565e` is interaction evidence, not production code.

## Compatibility and rollout

Migration follows [ADR 0017](./adr/0017-workspace-authority-rolls-out-through-one-canonical-cutover.md): bounded shadow backfill with transactional deltas, persisted byte-stable legacy-to-UUID mappings, validation, and one canonical cutover. Legacy behavior remains canonical until cutover. Historical records keep honest unknown provenance and cannot be reused for Project/Workload placement until full Review Bundle re-review. Contract harness v8 adds `context.approval`; v1–v7 continue their original `context.policy.approval` behavior unchanged.

`WORKSPACE_AUTHORITY_ROLLOUT` supports `off`, `shadow`, `canary`, and `enabled`. A deployment-owned stable-ID allowlist controls existing-workspace canaries. Gatekeeper authority enablement is separate and begins with R2. Before cutover, staging is disposable. After cutover, rollback is forward-only; turning the feature off hides new workflows but cannot re-enable legacy authority semantics.

## Package plan

| Package | Change |
| --- | --- |
| `packages/contractors` | harness v8, approval context, immutable artifact/instance inputs; retain v1–v7 |
| `packages/workshop-shared` | documented authority, event/evidence, development, workload, and Gatekeeper RPC contracts plus validators |
| `packages/workshop-backend` | deep `authority/` module, canonical store, sessions, resolver, effects, reconciliation, migration, compatibility façade |
| `packages/gatekeeper-r2` | first Gatekeeper authority protocol implementation and conformance tests |
| `packages/contract-review-builder` | internal reproducible candidate/verifier build Worker with no authority |
| `packages/contractors-cli` | Node CLI for login, development connect/status/disconnect, renewal, and local proxy |
| `packages/workshop-frontend` | proposal, decision, inventory, diagnostics, Graduation, and development views |
| `packages/router` | route browser APIs only; no public same-account workload route |
| `scripts/release` | new workers, service bindings, rollout inputs, and reviewed golden manifest |
| integration tests | R2 development, workload, migration, retraction, failure, and Graduation proofs |

Kernel/shared changes are split by concern and kept smaller than provider/UI changes. Existing mechanisms—Admin configuration reads, Cap'n Web promise pipelining, Gatekeeper capability encapsulation, Contract retraction, and the shared alarm—are extended rather than duplicated.

## Implementation sequence and gates

Each numbered slice is independently reviewable and leaves disabled or compatible behavior behind it.

1. **Compatibility baseline and controls.** Characterize legacy install/binding/retraction/harness behavior; add rollout flags and telemetry. Gate: golden compatibility tests pass with rollout `off`.
2. **Harness v8.** Add `context.approval`, retain all historical harnesses, and bind approval identity into new artifacts. Gate: v1–v8 fixtures execute; digest stability is proven.
3. **Shared protocols.** Add documented domain/RPC/event/evidence schemas and runtime validators. Gate: type/API tests reject unknown versions and malformed identities without casts.
4. **Canonical store.** Implement records, indexes, generations, `AuthorityStore.mutate`, operations, and atomic events. Gate: invariant/property tests cover retry, conflict, attribution, sequencing, and revocation.
5. **Effects and reconciliation.** Implement durable effects, retry policy, readiness reduction, and authority-first alarm ordering. Gate: crash-at-every-boundary tests converge without authority resurrection.
6. **Shadow migration.** Backfill staging, append/replay deltas, validate digest/references/cardinality, and expose diagnostics. Gate: production-shaped fixtures reach `readyToCutover` repeatedly with identical digest.
7. **Canonical cutover façade.** Publish staging atomically and implement legacy APIs over canonical records. Gate: old clients preserve Gadget behavior; incompatible writers fail closed; no dual authoritative reads remain.
8. **R2 authority protocol.** Implement identity, health, resource, verification, and instance lifecycle methods. Gate: provider conformance covers generations, receipt expiry, idempotency, retraction, and credential replacement.
9. **Review Bundle builder.** Add isolated candidate/verifier builds, content addressing, R2 persistence, and bounded attestations. Gate: same inputs reproduce; drift, network access, shared mutable state, and mismatched output fail closed.
10. **Project placement vertical slice.** Create Project/Environment/Binding Set, approve one artifact, resolve one R2 Source, install, bind, and expose readiness. Gate: all three modes have typed success/failure tests and never fall back.
11. **Authority API and minimum UI.** Add revocable sessions, proposals, decisions, inventory, events, and diagnostics. Gate: permission-generation tests plus keyboard/accessibility and stale-decision tests pass.
12. **Development backend.** Add grants, immutable templates, leased Consumers, renewal, expiry, and cleanup. Gate: fake-clock tests prove deadline enforcement and alarm priority.
13. **CLI and R2 proof.** Add login/connect/status/disconnect/local proxy and exercise the backend end to end. Gate: local R2 read/write demonstrates reconnect, renewal, revocation, expiry, and no leaked capability after cleanup.
14. **Cloudflare workload proof.** Add internal entrypoint, same-account Service Binding adapter, registrations, attachments, and replay/idempotency protection. Gate: wrong issuer/subject/generation/freshness and direct public calls fail; retraction wins over in-flight mutation.
15. **Graduation and rollback.** Add immutable plans, independent decisions, fresh installs, lineage, atomic readiness, and replacement rollback. Gate: no Gadget identity/state moves and partial failure exposes no Project authority.
16. **Canary and cleanup.** Run shadow comparison, activate stable-ID canaries, expand by health gates, document operator recovery, then remove obsolete write paths. Gate: migration/reconciliation dashboards are clean and every rollback boundary is exercised.

## Verification matrix

All slices run repository lint, type checks, builds, and tests. In addition:

| Area | Required proof |
| --- | --- |
| Runtime | artifact digest and harness compatibility; per-instance/shared state isolation |
| Authority store | atomic state/events, idempotent operations, generation conflicts, indexed invariants |
| Migration | live delta replay, crash recovery, digest repeatability, honest unknown history, old-client façade |
| Gatekeeper | credential opacity, stable identity, health separation, receipt binding/expiry, lifecycle idempotency |
| Review evidence | hermetic double build, content addressing, recipe/toolchain binding, bounded attestation |
| Resolution | exact mode semantics, no fallback, unique binding names, required-set atomic readiness |
| Reconciliation | failure injection before/after every external step, poison isolation, no resurrection |
| Authority API | role orthogonality, session revocation, proposal/decision separation, stale generation rejection |
| Development | exact grant/template, lease/renew/expire/reconnect/disconnect, R2 local proof |
| Workload | trusted transport, registration match, freshness, replay/idempotency, retraction race |
| Graduation | snapshot drift, independent decisions, fresh instances, lineage, partial failure, replacement rollback |
| UI | authorization, evidence completeness, typed diagnostics, keyboard/focus/live-region accessibility |

## Operational completion criteria

- All new and migrated workspaces use canonical authority records; no permanent dual model remains.
- R2 passes Gatekeeper conformance and the Project, development, and workload vertical slices.
- Every authority expansion has an attributable decision and every local transition has a sequenced event.
- Revocation and expiry fail closed synchronously by generation, with cleanup converging through effects.
- Required Consumer environments are either wholly ready or explicitly not ready.
- Shadow/canary metrics, migration diagnostics, stuck effects, credential attention, and operator recovery are documented and observable without logging secrets.
- Release manifests and deployment inputs cover new workers, bindings, rollout mode, and canary allowlist.
- Legacy Gadget behavior and old artifacts remain compatible, while legacy history cannot authorize new Consumer types.

## Decision traceability

| Decision | ADR | Ticket |
| --- | --- | --- |
| Workspace ownership | [0001](./adr/0001-workspace-authority-lives-in-the-workspace-do.md) | #6 |
| `manageAuthority` | [0002](./adr/0002-manage-authority-is-owner-granted-and-orthogonal.md) | #3 |
| Project/Consumer identity | [0003](./adr/0003-project-and-consumer-identities-are-authority-issued.md) | #4 |
| Source provenance and health | [0004](./adr/0004-source-ownership-and-credential-failure-are-separate.md) | #2 |
| Approval versus installation | [0005](./adr/0005-artifact-approval-and-installation-are-separate.md) | #7 |
| Exact resolution | [0006](./adr/0006-binding-resolution-never-guesses-or-falls-back.md) | #5 |
| Atomic audit events | [0007](./adr/0007-authority-transitions-and-events-commit-together.md) | #11 |
| Gatekeeper protocol | [0008](./adr/0008-gatekeeper-authority-is-identity-and-generation-bound.md) | #16 |
| Review Bundle | [0009](./adr/0009-review-bundles-are-reproducible-content-addressed-evidence.md) | #17 |
| Storage cutover | [0010](./adr/0010-workspace-authority-storage-cuts-over-once.md) | #14 |
| Leased development | [0011](./adr/0011-development-sessions-are-leased-capability-consumers.md) | #9 |
| Workload adapters | [0012](./adr/0012-workload-adapters-authenticate-evidence-not-authority.md) | #8, #10 |
| Graduation | [0013](./adr/0013-graduation-translates-authority-without-moving-it.md) | #12 |
| Authority API | [0014](./adr/0014-authority-administration-is-a-revocable-capability.md) | #15 |
| Decision UX | [0015](./adr/0015-authority-review-is-decision-first.md) | #18 |
| Reconciliation | [0016](./adr/0016-reconciliation-advances-committed-authority-through-durable-effects.md) | #19 |
| Compatibility sequence | [0017](./adr/0017-workspace-authority-rolls-out-through-one-canonical-cutover.md) | #13 |

Supporting evidence: leased-development prototype `ec7d331c8aa54175a3f8cadae0598dc53018e271`; authority-UX prototype `4b9f75974883d307dc6642865861152734a5565e`; Cloudflare workload-identity research `56d70dec010ef203355e4bccd91c0549a439774a`.
