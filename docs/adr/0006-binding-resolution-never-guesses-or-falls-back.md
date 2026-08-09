# Binding resolution never guesses or falls back

Every Consumer is assigned an exact version of one Environment-owned Binding Set. Each requirement in that set has a stable ID and immutable version, a unique binding name, required or optional readiness, one active Artifact Approval epoch, and exactly one Authority Mode. Workspace Authority resolves it to an immutable Binding Resolution and Installation Decision; repository configuration may request these identities but cannot author or select them.

`personal` selects an eligible Personal Source Grant belonging to the Consumer's authenticated human principal and is unavailable to a Consumer without one. `shared` pins one workspace-visible Source. `verified` pins one shared Source and requires current evidence that the Consumer's authenticated principal can independently access the same provider resource. A provider adapter may support a non-human verifier, but its identity and evidence must be explicit; workload identity alone is not verification.

Candidate discovery never confers authority. An existing approved resolution wins only while its exact generations remain eligible; one eligible candidate may form an Authority Proposal, zero candidates is unsatisfied, and multiple candidates is ambiguous. Workspace Authority never chooses by ordering, silently switches Sources, crosses Authority Modes, or falls back after credential or verification failure.

## Resolution and reconciliation

- A Binding Set is invalid if names collide. Names must satisfy the runtime binding-name grammar, and changing a name creates a new requirement version.
- A Binding Resolution records the exact Consumer, Environment, Binding Set and requirement versions, binding name, active Artifact Approval epoch, Source ID and generation, policy and verification result, shared-state selection, Contract Instance, and expected Binding generation.
- Verification happens before installation and produces a bounded receipt with verifier identity and generation, provider resource identity, verification time, and expiry. It is repeated when any bound identity or generation changes, before reactivation, and no later than receipt expiry. A transient verifier failure may use an unexpired receipt but never extends it.
- Reconciliation preserves an exact eligible active resolution and automatically performs authority reductions, including suspension and terminal retraction. It may prepare an expansion or redirect as an Authority Proposal, but it cannot activate one without an Authority Manager's Installation Decision.
- Removing or retiring a requirement retracts its instance. Changing its Artifact, Source, mode, Consumer, Environment, or binding name creates a replacement instance. The replacement becomes ready off-binding and compare-and-swaps the named Binding only if the expected Binding generation still matches; a stale writer replans.
- Recoverable Source or Account failure suspends the Binding without deleting its name, approval, or intended resolution. Terminal Source, Account, Personal Source Grant, Consumer, Environment, or requirement retirement retracts every dependent instance.
- A Consumer is ready only when all required requirements in its assigned Binding Set are active. Optional failures are reported but do not block readiness. Missing required bindings fail closed; no raw or partially resolved Source is exposed.

## Considered options

- Giving every Consumer every requirement in an Environment was rejected because different Workloads need different authority and an implicit superset violates least authority. Binding Sets make the assignment explicit and versioned.
- Selecting the first matching personal Source was rejected because ordering is not consent and changes as accounts are added or repaired.
- Treating `personal`, `shared`, and `verified` as fallback tiers was rejected because a fallback can silently redirect authority after failure.
- Verifying on first use was rejected because installation would create a capability before its principal and provider-resource relationship had been established.
- Mutating an existing Contract Instance during replacement was rejected because its authority tuple and derived capability graph must remain immutable.

## Consequences

- The resolver can be implemented as a deterministic plan over durable authority state, with side effects committed idempotently by the Workspace Authority DO.
- Development Session and Workload protocols must authenticate a Consumer before selecting its assigned Binding Set or resolving personal and verified modes.
- Provider adapters must return stable resource identity and bounded verification evidence, not just success or failure.
- The existing invariant that Consumer bindings target Contract Instances rather than Gatekeeper Sources remains the runtime enforcement boundary.

## Extended Authority amendment (ADR 0023)

“Every Consumer” above is scoped to standing Consumers. The canonical Resolution has closed
discriminants: a standing placement references one Environment Binding Requirement version,
Installation Decision, and exact Source Upstream Authority; a task placement references one Task
Binding Requirement in an immutable Task Template Version, Task Dispatch Decision, and exact Source or
Binding Upstream Authority. Both record the complete upstream generations, Artifact Approval epoch,
separate Contract Instance, shared-state choice, and expected Binding generation. Neither path guesses,
falls back, or exposes the Upstream Authority raw to its Consumer.
