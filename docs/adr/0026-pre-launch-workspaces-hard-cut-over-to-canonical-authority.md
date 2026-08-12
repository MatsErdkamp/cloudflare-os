# Pre-launch workspaces hard-cut over to canonical authority

Status: Accepted

## Context

ADR 0017 selected an expand–migrate–contract rollout that preserved eligible legacy Contracts,
Gadget bindings, and raw Manager Source authoring access. That compatibility machinery is now more
costly and risky than the pre-launch data it preserves: it retains two vocabularies, keeps obsolete
authority entrypoints callable, and makes the canonical boundary harder to review.

The product has made no compatibility promise for these pre-launch workspaces. Losing their legacy
installed authority and pending chat proposals is acceptable.

## Decision

Workspace Authority uses a hard canonical cutover. There is no legacy backfill, delta replay,
compatibility projection, fallback reader, raw Manager Source authoring capability, or automatic
conversion of pending chat bindings.

New code initializes the canonical Workspace Authority directly in `active` state. A workspace that
contains only legacy authority data receives no inferred Approval, Installation Decision, Contract
Instance, Binding, Source, actor, or provenance. Calls that depend on those records fail closed. The
user must recreate the authority through the current review and installation flow.

If the old authority module persisted a non-active pre-cutover staging state, first initialization
atomically discards it and begins a fresh active epoch. This reset is deletion, not migration: no
legacy identity, approval, placement, or event is carried forward. A workspace that already
activated imported legacy authority is rejected instead of deleting live endpoint recovery facts;
the user must create a new workspace and use the current review/install flow there.

Legacy chat history may remain inert historical content, but it is never replayed into authority.
Legacy storage collections and RPC/export surfaces are deleted once their code callers are removed.
There is no rollback to legacy semantics and no deployment telemetry gate for their removal.

This ADR supersedes ADR 0017's migration lifecycle, historical-data preservation, deployment
rollout, compatibility façade, and pre-cutover rollback sections. ADR 0017's one-way canonical
authority, no-dual-authority, fail-closed old-writer, and forward-repair principles remain in force.

## Consequences

Old workspaces and chats can lose installed Contract reachability and raw Source authoring access
after deployment. That breakage is intentional. The implementation becomes smaller: only canonical
authority records can authorize execution, and reviewers no longer need to reason about a migration
state machine or fallback behavior.

## Alternatives considered

- Preserving eligible legacy authority through staged backfill was rejected because pre-launch
  continuity is not worth maintaining the compatibility security surface.
- Keeping read-only fallback projections was rejected because they perpetuate ambiguous lifecycle
  ownership and encourage new callers.
- Waiting for zero-use telemetry was rejected because the accepted product behavior is to break
  legacy callers rather than preserve them.
