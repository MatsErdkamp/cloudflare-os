# Artifact approval and installation are separate

Workspace Authority records Artifact Approval independently from each Installation Decision. An approval binds an exact executable Artifact hash to an exact Review Bundle hash; an installation separately binds one approval epoch to one Source identity and generation, one Consumer, and one Binding. A combined UI may collect both decisions, but neither decision implies the other.

Replacement and rollback create new Contract Instances and atomically redirect the Binding only after the replacement is ready. They never mutate an existing instance's Artifact, Source, Consumer, or state, and they never resurrect a retracted capability graph.

## Considered options

- Treating installation as proof that an Artifact is globally approved was rejected because code review and capability placement have different scopes and revocation consequences.
- Updating an existing instance in place was rejected because it would obscure which authority tuple produced a capability and make rollback/retraction ambiguous.
- Hashing review prose and generated diffs into executable authority was rejected because the emitted executable remains the security boundary; review evidence is independently content-addressed and bound by the approval record.

## Consequences

- The same approved Artifact may be installed more than once, but every placement needs its own Installation Decision.
- A Development Placement Template is the prior human decision authorizing a bounded family of exact per-Session placements. Each materialized Installation Decision cites that template, its Development Session Grant and manager generation, and the new Consumer; the system does not make a new selection.
- Changing the Source or Consumer is a new installation even when the Artifact hash is unchanged.
- Rollback installs a previously approved Artifact as a new instance and requires a fresh placement decision.
- The sole current authoring interface exposes Runtime Approval Gates at `context.approval`.

## Extended Authority amendment (ADR 0023)

Installation Decision is the standing-placement decision. A task instead uses a distinct Task
Template Approval and per-task Task Dispatch Decision through the same Binding Resolution model.
“Runtime Approval Gate” is now the distinct Runtime Approval Request/Decision pair; organization and
resource-owner gates are separate conjunctive release conditions. All may release authority already
present in the installed Contract/current task envelope, but none may create, broaden, extend, or
restore it. Replacement publication and retraction follow ADRs 0019 and 0020.

## Current-format amendment (ADR 0024)

The historical-harness compatibility consequence is superseded. Before launch, Contracts have one
current content-addressed executable format and no numeric harness selector.
