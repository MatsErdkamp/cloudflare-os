# Workspace Authority

Workspace Authority is the workspace-owned system that governs Sources, Contract approval, Consumers, environments, and bindings.

## Language

**Workspace Authority**:
The authority boundary that decides which approved capabilities a workspace's Consumers may possess.
_Avoid_: Manager when referring to the domain concept

**Authority Manager**:
A named workspace member whom the owner has explicitly granted `manageAuthority`. An Authority Manager may make workspace authority decisions but gains no build rights from that permission.
_Avoid_: Builder, Admin

**Authority Proposal**:
A requested change that would expand or redirect a Consumer's authority and therefore requires an Authority Manager's explicit decision before it takes effect.
_Avoid_: Approved change, automatic grant

**Personal Account**:
A user-owned connection to an external provider whose credentials and lifecycle remain under that user's control.
_Avoid_: Workspace Account, shared account

**Workspace Account**:
A workspace-owned connection established specifically for organizational use and governed by Authority Managers, while its credentials remain encapsulated by its Gatekeeper.
_Avoid_: Shared Source, service account when the provider does not use that term

**Personal Source Grant**:
A user's revocable consent for one workspace to retain a derived Source capability for a specific resource from that user's Personal Account.
_Avoid_: Account sharing, credential delegation

**Source Record**:
A workspace-owned provenance and lifecycle record for one provider resource derived from a Personal or Workspace Account. It identifies a Source capability but never contains provider credentials.
_Avoid_: Credential record

**Credential Health**:
The latest generation-bound, non-secret assessment reported by a Gatekeeper for an Account: healthy, unknown, or attention required. It is evidence used by eligibility rules, not Account ownership, Source lifecycle, or permission.
_Avoid_: Permission, authorization policy

**Provider Account Identity**:
The stable tuple of Gatekeeper vendor, provider issuer, and provider-issued account subject that anchors Account continuity across credential replacement.
_Avoid_: Display name, email address, connected-account row ID

**Provider Resource Identity**:
The stable tuple of Gatekeeper vendor, provider issuer, resource type, and provider-issued resource key that anchors a Source to one external resource.
_Avoid_: Canonical URL, resource title, Source ID

**Project**:
A stable workspace-owned identity that groups Repository Claims, named Environments, Development Sessions, and Workloads for one body of software.
_Avoid_: Repository when referring to the aggregate

**Repository Claim**:
Attributed metadata asserting that a repository or subdirectory relates to a Project. A claim may aid discovery and review but is never a Consumer identity or source of authority.
_Avoid_: Project identity, trusted repository

**Consumer**:
An authority-recognized Gadget, Development Session, or Workload that may receive capabilities from Contract Instances.
_Avoid_: App when the distinction matters

**Development Session**:
A short-lived leased Consumer belonging to one Project and resolving one Environment for the lifetime of its lease.
_Avoid_: Local daemon, developer machine

**Development Session Grant**:
An Authority Manager's revocable authorization for one named developer to mint short-lived Development Sessions for one exact Project, Environment, and Binding Set version. It authorizes repetition within that fixed envelope, not new placement choices.
_Avoid_: Session, build permission, blanket development access

**Development Lease**:
The bounded, renewable lifetime of one Development Session. Expiry invalidates that Consumer and every capability derived for it even if cleanup or an alarm runs later.
_Avoid_: Login session, transport connection

**Workload**:
A stable Project-owned Consumer whose deployed caller is authenticated by a trusted provider-specific identity adapter and resolves one Environment.
_Avoid_: Project ID, deployment claim

**Environment**:
A stable, Project-owned authority target with a unique human-readable name, such as development, preview, or production. Branch names and deployment labels may suggest an Environment but never select one authoritatively.
_Avoid_: Deployment when referring to the authority configuration

**Binding Requirement**:
A stable, versioned declaration within a Binding Set that names one capability, pins one Artifact Approval epoch, and constrains how Workspace Authority may select and verify its Source.
_Avoid_: Grant, environment variable

**Binding Set**:
A stable, versioned set of Binding Requirements owned by one Environment and assigned explicitly to a Consumer. It is the Consumer's complete desired capability surface for that Environment.
_Avoid_: Ambient environment, inferred dependencies

**Authority Mode**:
The single resolution rule on a Binding Requirement: `personal`, `shared`, or `verified`. Modes constrain Source eligibility and verification; they are not Source types and never define fallback order.
_Avoid_: Source type, automatic fallback

**Binding Resolution**:
Workspace Authority's immutable result for one Consumer and one Binding Requirement version, recording the exact Source, verification result, Installation Decision, Contract Instance, and expected Binding generation.
_Avoid_: Candidate, best match

**Verification Receipt**:
A bounded, expiring Gatekeeper result proving that one generation of a verifier principal independently satisfied a declared access check for one exact Provider Resource Identity.
_Avoid_: Permission grant, verifier capability

**Binding**:
The generation-tagged, uniquely named association through which one Consumer possesses the capability produced by one Contract Instance.
_Avoid_: Grant, permission

**Authority Event**:
An immutable, workspace-sequenced audit fact written atomically with the local authority decision or lifecycle transition it records. It is an audit projection of authority state, not an operational log or the source of truth.
_Avoid_: Log line, Source Action

**Authority Operation**:
An idempotent causal group containing every Authority Event produced while carrying one requested change or recovery step across local state and external effects.
_Avoid_: Request ID, transaction

**Authority Generation**:
A monotonic security epoch on an Account, grant, Source, Consumer, permission, Binding, or capability. A generation mismatch invalidates previously derived authority even when the stable identity is unchanged.
_Avoid_: Record revision, schema version, display version

**Graduation**:
Creation of Project-owned Contract Instances equivalent to a Gadget's approved bindings, with lineage back to the Gadget and without changing the Gadget's live security identity.
_Avoid_: Export, moving an instance
