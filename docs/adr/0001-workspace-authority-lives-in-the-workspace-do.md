# Workspace Authority lives in the existing workspace Durable Object

Workspace Authority will deepen the existing Overseer-backed workspace Durable Object rather than introduce a parallel Manager Durable Object. The workspace already serializes Gatekeeper placement, Contract Instance records, Consumer bindings, tombstones, and Retraction; keeping the new authority records there preserves one lifecycle owner and avoids cross-Durable-Object transactions during installation, replacement, and revocation. The User Durable Object continues to own personal accounts, Workspace Authority owns Workspace Accounts and Source provenance, Gatekeepers own credentials and remote-resource capabilities, and the Contract Runtime owns artifact execution plus instance state.

## Considered options

- A separate Manager Durable Object was rejected because it would split the authority graph from the records and facets it governs, creating duplicate mechanisms and distributed cleanup failure modes.
- The owner's User Durable Object was rejected because workspace authority must be shared, survive collaborator and owner-session changes, and remain scoped to the workspace rather than a person.

## Consequences

- Existing `gatekeepers` and `contracts` storage evolve through migrations instead of being shadowed by a second registry.
- Personal account capabilities stay in their User Durable Object; Workspace Authority records explicit provenance and retains only the derived Source capability needed by the workspace.
- Account removal, Source retirement, workspace deletion, and Contract retraction converge on Workspace Authority as the single orchestration point.
