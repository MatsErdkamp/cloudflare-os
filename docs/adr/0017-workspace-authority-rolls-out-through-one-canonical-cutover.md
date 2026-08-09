# Workspace Authority rolls out through one canonical cutover

Status: Accepted

## Context

Existing workspaces store Gatekeeper and current-format Contract records, Gadget bindings, chats, hooks, action logs, and state without the identity, provenance, decision, and Consumer records required by Workspace Authority. The migration preserves eligible installed capabilities while removed Contract formats fail closed under ADR 0024; historical ambiguity cannot become new authority.

The workspace Durable Object already has a small synchronous storage migration. Authority backfill can be much larger, may require retries, and must coexist with live legacy mutations. A permanent dual-read or dual-write design would leave two security models indefinitely able to disagree.

## Decision

Workspace Authority has its own migration lifecycle, independent of the existing `storage.version`:

`legacy` → `backfilling` → `readyToCutover` → `active`

Before cutover, legacy records remain canonical. Backfill writes invisible staging records in bounded, checkpointed batches. Every legacy authority mutation transactionally appends a migration delta; replay advances to a recorded high-water mark. Staging may be discarded and rebuilt without affecting live behavior.

Cutover is one local transaction. It verifies record counts, references, unique names, binding cardinality, a deterministic digest, the delta high-water mark, and the minimum compatible writer version. It then publishes the staged collections, canonical Bindings, a single explicitly unknown-history baseline event, and the `active` schema marker. After cutover, only canonical authority collections are authoritative. Legacy APIs become compatibility façades over them, old Gadget maps are projections, and an old writer fails closed. Post-cutover defects are repaired forward; the workspace never switches the legacy model back on.

### Historical data

The migration preserves existing Gadgets, installed capabilities, personal Accounts, action logs, chats, Approval Gates, hooks, state, and retraction behavior. It does not invent identities, actors, evidence, or approvals:

- each existing Gatekeeper record becomes an identity-unverified legacy Source;
- each current-format live or tombstoned Contract becomes a distinct imported Artifact Approval and Installation Decision;
- each Contract-backed Gadget edge becomes a canonical Binding;
- each raw Gatekeeper edge becomes a Legacy Compatibility Binding;
- an unbound current-format Contract remains explicitly unbound;
- pre-launch Contract data must already use the sole current executable format or fail closed under
  ADR 0024; no historical Contract format is reinterpreted or migrated in place.

Legacy personal Gadget flows remain available. Their records cannot seed Project, shared, verified, Development Session, Workload, or Graduation authority until a manager makes the corresponding new-model decisions. Existing build collaborators keep installed capability use, but cannot approve new authority unless the owner separately grants `manageAuthority`; migration never auto-grants that permission.

### Deployment rollout

Deployments set `WORKSPACE_AUTHORITY_ROLLOUT` to:

- `off`: no backfill or new authority UI;
- `shadow`: build, replay, validate, and compare staging only;
- `canary`: activate disposable/new workspaces plus a deployment-owned allowlist of stable workspace IDs;
- `enabled`: create new workspaces active and migrate existing workspaces in bounded batches.

Turning the flag off after cutover hides new proposals and UI, but the canonical compatibility façade, security checks, retraction, and reconciliation remain active.

The Gatekeeper authority protocol is gated independently. R2 is the first provider. The first production workload adapter uses a same-account Cloudflare Service Binding; Cloudflare Access service tokens are a later cross-account option.

### Rollback boundary

- In `legacy`, use ordinary release rollback.
- In `backfilling`, stop workers and discard/rebuild staging.
- In `readyToCutover`, revalidate or discard staging.
- In `active`, use forward fixes and feature disablement only.
- Cleanup after a committed local retraction never restores authority.

### Review-sized delivery order

1. current Contract characterization and rollout controls;
2. shared protocols and validators;
3. authority storage, events, operations, effects, reconciliation, and alarm priority;
4. shadow backfill, delta replay, validators, and canonical cutover façade;
5. R2 Gatekeeper authority protocol and reproducible Review Bundle builder;
6. Projects, environments, resolution, and R2 installation;
7. revocable Authority API and minimum decision UI;
8. leased development backend, CLI, and R2 local-development proof;
9. same-account Cloudflare workload attachment;
10. Graduation, rollback, canary expansion, and legacy cleanup.

## Consequences

The rollout is recoverable before cutover and intentionally forward-only afterward. Eligible current-format access remains usable without being misrepresented as verified authority. Kernel changes can be reviewed by concern, and each provider or Consumer type must pass its own conformance gate before expansion.

## Alternatives considered

- Permanent dual-read or dual-write storage was rejected because disagreements become an enduring security ambiguity.
- A synchronous constructor migration was rejected because it is unbounded and cannot safely reconcile live writes.
- Automatically granting authority management to builders was rejected because build and authority roles are orthogonal.
- Rewriting old artifacts or inferring provider identities was rejected because it fabricates provenance.
- Enabling every provider or shipping workload attachment before the development slice was rejected because it broadens the trust boundary before the end-to-end model is proven.

## Extended Authority amendment (ADR 0023)

The ten-step standing delivery order above was provisional and is superseded by the exact issue DAG
and conformance matrix in `docs/workspace-authority.md`. Its migration invariants remain controlling:
bounded invisible staging, transactional deltas, one canonical cutover, no permanent dual authority,
content-addressed current artifacts, and forward-only repair after activation. ADR 0024 supersedes
historical Contract-format preservation before launch.
