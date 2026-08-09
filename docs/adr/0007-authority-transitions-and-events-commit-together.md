# Authority transitions and events commit together

Workspace Authority keeps its durable current-state records as the source of truth and maintains a separate append-only Authority Event stream as their audit projection. Every committed local authority decision or lifecycle transition and its event are written in the same Durable Object storage transaction; if the event cannot be appended, the local transition does not commit. The stream is deliberately separate from the Source Action Log and structured operational logs.

Events have a total order only within one workspace. A monotonically increasing sequence is normative; wall-clock time is informational. A command that produces several events appends them in a deterministic order in one transaction. Consumers reconnect with a sequence cursor and may receive duplicates, but never observe committed events out of order.

## Event envelope

Every event has an immutable sequence, schema version, event type, recorded time, actor, Authority Operation ID, optional causation event sequence, typed subject references, and a discriminated bounded payload. An actor is exactly one of:

- a human profile with the authority or consent grant generation used for the decision;
- an authenticated Consumer with its identity/session generation;
- a provider adapter reporting an observed lifecycle fact;
- the Workspace Authority system naming the reconciler, expiry, migration, or recovery component.

Correlation is represented by the Authority Operation ID. Immediate cause is represented by the causation sequence. Domain lineage remains explicit in typed payload fields such as predecessor instance, superseded approval epoch, replacement resolution, or rollback target; it is not inferred from timestamps.

Event schemas allow only bounded identifiers, generations, enums, timestamps, hashes, counts, and reason codes. Serialized events are capped at 16 KiB, collections at 32 entries, and extension strings at 128 UTF-8 bytes. They contain no credentials, capabilities, tokens, headers, prompts, request or response bodies, error messages, email addresses, display names, arbitrary URLs, or free-form prose. Provider identities and resources are referenced by workspace-local opaque IDs and adapter-declared audit-safe fingerprints, never raw provider keys. Large affected sets use one event per actual transition or a count and digest, not an unbounded ID array.

## Required event families

An event is mandatory when durable authority, eligibility, readiness, or cleanup responsibility changes, or when a human/system decision is recorded. The typed vocabulary includes:

- owner and Authority Manager grant, revoke, recovery, and grant-generation invalidation;
- Workspace Account and Personal Source Grant creation, consent, revocation, retirement, remote-cleanup request, success, failure, and abandonment;
- Source creation, generation change, suspension, reactivation, identity mismatch, retirement, and dependent blocking or Retraction;
- Project, Repository Claim, Environment, Consumer, Workload registration, Development Session lease, Binding Set assignment/version, and Binding Requirement lifecycle transitions;
- resolution becoming unsatisfied or ambiguous, verification receipt issuance/renewal/expiry/denial/invalidation, and required-readiness changes;
- Artifact Proposal creation/staleness/decision, Artifact Approval epoch activation/deprecation/revocation, and the exact Artifact, Review Bundle, and comparison hashes decided;
- Installation Proposal creation/staleness/decision, installation attempt outcome, Contract Instance readiness/suspension/reactivation/Retraction, Binding compare-and-swap success or stale failure, and replacement/rollback lineage;
- migration baseline, reconciliation recovery, and externally visible partial-cleanup outcomes.

Repeated reconciliation that produces no durable transition emits no Authority Event. Operational retries and errors remain structured logs until they change durable state, cleanup responsibility, or an externally visible outcome. Source observations, actions, Approval Gates, and hook activity remain in the existing Source Action Log, carrying Contract attribution where applicable; they are not duplicated into the authority stream.

A combined UI confirmation of Artifact Approval and Installation Decision writes two independently typed decision events with distinct decision IDs, the same human actor, and one Authority Operation ID. Consent by a Personal Source owner and placement by an Authority Manager are likewise distinct actors and events even when one flow coordinates them.

## External effects and recovery

External effects are never presented as atomically committed with Durable Object state. Workspace Authority first records a durable intent/attempt state and event with an idempotency key, performs the external call, then atomically records the observed outcome and event. A crash may leave an attempt pending or unknown; reconciliation retries or verifies it under the same Authority Operation and idempotency key. The stream records what Workspace Authority decided and observed, not an unverifiable claim about global provider chronology.

Automatic authority reduction names the lifecycle event that caused it. Reactivation of the exact previously approved tuple names both that cause and the still-active Installation Decision. An unknown external outcome never produces a success event and never selects a fallback Source or Authority Mode.

## Query, retention, and integrity guarantees

Only the workspace owner and a caller holding a live `manageAuthority` capability may query the full stream. Other Consumers receive current readiness and their own binding diagnostics through narrower APIs, not filtered access to the audit stream. Queries are cursor-paginated by sequence, capped at 200 events, and may filter by event family, typed subject, actor, or Authority Operation using durable indexes. A response includes the workspace high-water sequence so a client can page a stable prefix and then subscribe from that cursor.

Events are never updated, deleted, or compacted while the workspace exists; corrections and schema evolution append new events. They share the workspace's durability and deletion lifecycle and are purged when the workspace is deleted, subject to the deployment's ordinary backup retention. This is not a regulatory or cross-workspace archive. A future compliance sink must consume the ordered stream and anchor its own signed checkpoints.

The guarantees are transactional completeness for local authority transitions, per-workspace total order, immutable application-level records, bounded disclosure, and durable replay from the retained stream. They do not include global ordering, exactly-once subscriber delivery, proof of unobserved provider activity, cryptographic tamper evidence against code with write access, or retention after workspace deletion. A hash chain without an independently protected external anchor was rejected because the same compromised writer could rewrite both records and hashes.

Legacy migration records one baseline event containing the migrated schema version, counts, and a canonical state digest. It does not fabricate historical actors, timestamps, or decisions; legacy Source Action Logs remain separate historical evidence.

## Consequences

- Authority mutation helpers must require an event description and commit state plus events through one narrow transactional writer.
- External workflows need durable attempt records and idempotency before their side effects run.
- Event payload types and exported query APIs require exhaustive unions, size validation, and public API documentation.
- Persistence design must index sequences, subjects, actors, operations, and unresolved external attempts without introducing a second authority source of truth.

## Extended Authority amendment (ADR 0023)

The same atomic event rule covers Template Approval lifecycle, Task Dispatch Decisions, Agent Task
lifecycle, Task Environment and Ratchet generations, protected-result/declassification decisions, and
task cleanup. New evidence uses four distinct families: Authority Events, task-neutral Source Activity,
task-correlated Agent Activity, and structured operational logs. Historical Source Action Log records
remain compatible evidence and are not rewritten; “Source Action Log” is not the canonical name for
new provider activity records.
