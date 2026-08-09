# Source ownership and credential failure are separate

A Source Record is owned by Workspace Authority but remains derived from either a workspace-owned Account or a user-owned Personal Source Grant. Provider credentials stay inside Gatekeepers; personal consent is not converted into workspace ownership, and a Personal Account is never promoted in place to a Workspace Account.

Credential expiry is recoverable availability loss: it suspends affected Sources, invalidates active Source sessions, and blocks their Contract Instances without erasing approvals or bindings. Explicit Account retirement, Personal Source Grant revocation, Source retirement, or provider-identity replacement is terminal: Workspace Authority revokes locally first, retracts every dependent Contract Instance, preserves tombstones and audit lineage, and retries remote cleanup independently.

## Considered options

- Copying personal account capabilities into the workspace without a durable consent record was rejected because the user could not inspect or revoke each delegation reliably.
- Treating credential expiry as terminal retraction was rejected because ordinary reauthentication would destroy reviewed configuration and force needless reapproval.
- Leaving broken Gatekeepers in place after Account removal was rejected because implicit provider failure is not a reliable revocation mechanism and does not clean up the capability graph.

## Consequences

- Reauthentication may resume suspended Sources only when the provider account identity is unchanged.
- Reauthentication as a different provider identity creates a new Account; existing Sources never silently retarget.
- Source eligibility is computed from lifecycle, Account health, consent generation, deployment policy, and any Consumer-specific verification rather than stored as a mutable boolean.
- Local revocation wins even when provider cleanup or cross-Durable-Object notification fails.

## Extended Authority amendment (ADR 0023)

“Local revocation wins” uses ADR 0020's enforcement-first sequence: persist exact invalidation intent,
invalidate and acknowledge every participating Binding Enforcement Endpoint and release gate, commit
the canonical terminal generation at the Revocation Commit Point, then run provider cleanup Effects.
Cross-Durable-Object/provider failure cannot restore locally invalidated authority.
