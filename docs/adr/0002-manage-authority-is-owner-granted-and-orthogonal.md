# `manageAuthority` is owner-granted and orthogonal to collaborator roles

Workspace authority administration will use a distinct `manageAuthority` permission rather than extending the ordered `build`/`use` collaborator roles. The owner holds it implicitly and permanently. The owner may grant it only to a named workspace member, independently of that member's collaborator role; grants never propagate through the sharing graph or share links, and an Authority Manager cannot grant the permission to another member.

Authority-expanding and authority-redirecting operations are exposed through a separately minted, revocable authority capability. Revoking a grant invalidates capabilities minted from that grant without waiting for the user to reopen the workspace. The owner remains the recovery principal and is the only principal allowed to grant or revoke `manageAuthority`, transfer ownership, or perform a destructive workspace-level break-glass action.

The capability is an ephemeral Authority Session bound to the authenticated principal, permission generation, and workspace authority epoch. Every call revalidates those epochs in Workspace Authority; revocation does not depend on restarting the workspace Durable Object. Revocation prevents new decisions but does not silently revoke decisions that committed while the grant was live. Their exact effects may still be reconciled unless the owner separately suspends or retracts them.

## Considered options

- Treating `build` as authority administration was rejected because repository editing and credential-backed capability placement are different trust decisions.
- Adding `manageAuthority` as a higher transitive collaborator role was rejected because collaborators and bearer share links must not be able to delegate control of workspace authority.
- Rechecking only when a workspace is reopened was rejected because a previously minted RPC stub would retain sensitive authority after its grant was revoked.

## Consequences

- Existing build collaborators are not migrated to Authority Managers; only the owner receives the implicit permission.
- Authority Managers may inspect bounded provenance and audit detail and may decide proposals even when they do not have build access.
- Builders may create proposals and inspect non-sensitive status, but approval, installation, replacement, retraction, Source lifecycle, Environment policy, Workload registration, and Graduation require the authority capability.
- A personal account owner must still consent to use of their personal Source; `manageAuthority` cannot impersonate or expropriate that user.
- Automated reconciliation may preserve or reduce existing authority but must never expand it without an Authority Manager decision.
