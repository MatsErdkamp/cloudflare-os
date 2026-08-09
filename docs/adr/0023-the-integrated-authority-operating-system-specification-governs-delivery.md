---
status: accepted
---

# The integrated Authority Operating System specification governs delivery

## Context

ADRs 0001–0017 established standing Workspace Authority. ADRs 0018–0022 extended that model with one
bounded Agent Task Authority path and selected the previously unresolved enforcement, revocation,
lifetime, Template, dispatch, Ratchet, and protected-result mechanisms. Several older ADRs use
unqualified standing-only language or provisional ordering that is false when read as a universal
extended rule.

## Decision

[`docs/workspace-authority.md`](../workspace-authority.md) is the normative integrated implementation
and conformance specification. It preserves the historical decisions while explicitly qualifying the
standing-only statements listed in its supersession table. Concise amendment sections in the affected
ADRs point readers to the controlling extended rule rather than silently rewriting the historical
record.

The integrated specification fixes:

- one Workspace aggregate and one discriminated standing/task Consumer and Binding Resolution model;
- the Contract Instance Facet TCB, acknowledged publication, enforcement-first Revocation Commit
  Point, and crash/restart behavior;
- immutable Task governance, exact dispatch, deadline-bounded lifecycle, subset-only Ratchet, and
  protected-result release barrier;
- package ownership, approval taxonomy, Authority Debt, and four-way evidence/log separation;
- an exact dependency-ordered issue programme and conformance matrix through #44.

## Consequences

Implementation tickets may refine schemas and interfaces only inside these invariants. A refinement
that changes an authority boundary, permits a broader runtime path, or weakens a conformance row needs
a new explicit decision; it cannot be introduced as an implementation detail. #31 and #34 remain
blocked until this architecture gate is accepted.
