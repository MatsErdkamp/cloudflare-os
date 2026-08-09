---
status: accepted
---

# Binding enforcement lives at the Contract execution Facet

## Context

Canonical Binding, Consumer, lease, authority-epoch, Agent Task, Task Environment, and Trust Ratchet generations live in the Workspace aggregate, while a Contract Instance executes in a storage-isolated Facet. A narrowly scoped Contract capability must reject stale roots, derived capabilities, callbacks, streams, and restoration paths without requiring Overseer to understand and reflect every Contract method and returned shape.

The #22 workerd prototype compared three R2-backed topologies:

| Topology                                      | Application transitions to R2 | RPC dispatch boundaries | Authority TCB modules | Observed result                                                                                                                       |
| --------------------------------------------- | ----------------------------: | ----------------------: | --------------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| Supervisor-hosted returned capability         |                             5 |                       3 |                     2 | Freshness is direct, but Overseer remains method-aware and operationally on every call                                                |
| Separate Binding Facet/Gateway                |                             4 |                       5 |                     3 | Raw Facet stubs are non-serializable; the extra shallow gateway adds dispatches and does not remove the supervisor transport membrane |
| Generation snapshot plus Contract Facet abort |                             2 |                       3 |                     2 | Smallest application-level path; materialized roots, derived targets, and provider-retained callbacks fail after abort                |

The application-transition count is the prototype's closed module trace (`supervisor check/reflect`, Binding Facet, Contract Facet, provider, R2). The RPC count instead enumerates the constructed logical dispatch boundaries on the ordinary read path: caller to supervisor, supervisor to Facet, any Facet-to-supervisor loopback, and Contract Facet to provider. It excludes local R2 access and is not a latency, billing, or wire-packet claim.

The comparative authority TCB is also a closed inventory. The supervisor-hosted topology trusts the supervisor policy membrane and Contract Facet membrane; the separate-gateway topology trusts the supervisor publication/loopback membrane, Binding Facet membrane, and Contract Facet membrane; the selected topology trusts the supervisor publication/invalidation lifecycle and Contract Facet membrane. The common workerd/RPC substrate and upstream provider are outside this comparative application TCB. From a browser, Cap'n Web still enters through an Overseer-owned transport capability. Because a raw Facet `Fetcher` cannot cross Workers RPC or Cap'n Web, Overseer remains operationally present as the capability introducer/proxy in every topology. The selected topology removes Overseer application policy and method reflection from ordinary calls; it does not claim direct browser-to-Facet transport.

## Decision

The Binding Enforcement Endpoint is the Contract Instance execution Facet itself, using an immutable generation snapshot plus synchronous supervisor invalidation. A separate Binding Facet/Gateway is not introduced.

Before publishing a Binding, Workspace Authority must:

1. derive one exact snapshot of every relevant canonical identity and generation, including Binding, Consumer, Contract Instance, Artifact Approval, Upstream Authority, lease/authority epoch, and Agent Task, Task Environment, and Trust Ratchet generations where applicable;
2. materialize the exact Contract Instance Facet rather than retain an unused lazy `Fetcher`;
3. require the Facet to durably install and acknowledge the exact snapshot and its digest;
4. revalidate the canonical expected generations after acknowledgement; and
5. only then publish a supervisor-owned, non-method-aware transport capability for that acknowledged endpoint.

The prototype proved durable exact-snapshot installation and acknowledgement for the issue-required Binding, Consumer, lease, authority-epoch, Agent Task, Task Environment, and Trust Ratchet generations. The broader Contract Instance, Artifact Approval, and Upstream Authority fields, plus a canonical digest, are production requirements established here; the prototype did not claim to implement or validate those additional fields.

An unused pre-abort Facet `Fetcher` is never publishable authority. The prototype proved that aborting a name with no materialized Facet is a no-op and that first use of a previously captured lazy handle can subsequently start its captured old generation. Publication-time materialization and acknowledgement close that gap; canonical generation is never inferred from Facet existence or startup callback execution.

Whenever any snapshot input becomes stale, Workspace Authority synchronously aborts the materialized Contract Instance Facet name. This substitutes graph-wide invalidation for a per-call read of canonical supervisor storage, which Facet isolation makes impossible. A fresh endpoint must materialize and acknowledge again before publication, including after an explicit Facet restart. Facet-local state is a generation-bound execution snapshot, never a second source of authority.

## Capability lifetime

Local workerd conformance demonstrated ordinary invocation, Cap'n Web-style promise pipelining, derived targets, provider-retained callbacks, explicit disposal, replacement, stale-stub failure, Facet abort/restart, and the lazy-handle edge. Materialized roots, derived targets, and retained callbacks failed after abort. Disposal released resources but was not treated as authority revocation.

Already-transferred readable streams did not fail closed in any topology: after replacement their next read remained pending rather than rejecting or delivering another chunk. Authority-bearing or protected streams therefore may not be released as raw transferred streams. Each released chunk or completed result must cross a generation-checking mediator, and abort/cancellation acknowledgement must be proven by the Contractors lifecycle and standing/task conformance tickets before that stream shape is supported. Unsupported stream shapes fail closed.

The prototype exercised explicit Facet abort followed by same-generation rematerialization. Generic actor eviction, full container cleanup, supervisor restart, process restart, and production-runtime behavior remain separate conformance cases; no correctness claim depends on local idle timings or undocumented transitive Facet behavior.

## Consequences

- Overseer owns canonical snapshot derivation, acknowledgement gating, publication, and invalidation, but not method-aware ordinary dispatch.
- Contractors owns the deep capability-graph membrane at the Contract Instance Facet seam and must cover every supported returned asynchronous shape.
- Gatekeepers remain task-neutral; the Binding Enforcement Endpoint adds Consumer and task-generation correlation before protected results are released.
- Direct Facet serialization, an unacknowledged lazy handle, disposal, and Facet existence are never accepted as proof of current authority.
- #23 must choose the crash-safe ordering and externally visible revocation point between canonical mutation, Facet invalidation, acknowledgement, and reconciliation; this ADR does not pre-empt that decision.

## Evidence

- Prototype branch: `codex/prototype-binding-enforcement-topologies`, commits `43770120` and
  `6283a189`
- Primary-source research: [`docs/research/dynamic-worker-facets-binding-enforcement.md`](../research/dynamic-worker-facets-binding-enforcement.md)
