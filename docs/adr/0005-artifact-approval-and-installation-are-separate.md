# Artifact approval and installation are separate

Workspace Authority records Artifact Approval independently from each Installation Decision. An approval binds an exact executable Artifact hash to an exact Review Bundle hash; an installation separately binds one approval epoch to one Source identity and generation, one Consumer, and one Binding. A combined UI may collect both decisions, but neither decision implies the other.

Replacement and rollback create new Contract Instances and atomically redirect the Binding only after the replacement is ready. They never mutate an existing instance's Artifact, Source, Consumer, or state, and they never resurrect a retracted capability graph.

## Considered options

- Treating installation as proof that an Artifact is globally approved was rejected because code review and capability placement have different scopes and revocation consequences.
- Updating an existing instance in place was rejected because it would obscure which authority tuple produced a capability and make rollback/retraction ambiguous.
- Hashing review prose and generated diffs into executable authority was rejected because the emitted executable remains the security boundary; review evidence is independently content-addressed and bound by the approval record.

## Consequences

- The same approved Artifact may be installed more than once, but every placement needs its own Installation Decision.
- Changing the Source or Consumer is a new installation even when the Artifact hash is unchanged.
- Rollback installs a previously approved Artifact as a new instance and requires a fresh placement decision.
- Runtime Approval Gates move from `context.policy.approval` to `context.approval` in a new harness version; old hashed Artifacts retain their historical interface.
