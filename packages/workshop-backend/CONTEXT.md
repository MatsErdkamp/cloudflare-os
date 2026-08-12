# Workspace Authority

Workspace Authority is the workspace-owned system that governs standing authority and the bounded authority of each Agent Task without owning provider credentials or Contract execution. The Workspace is its sole transactional aggregate.

## Language

**Workspace**:
The organizational boundary and sole transactional aggregate for all standing and Agent Task Authority in one workspace.
_Avoid_: Project, Manager aggregate, Task aggregate

**Workspace Authority**:
The workspace-owned authority boundary that decides which approved capabilities its standing and Agent Task Consumers may possess.
_Avoid_: Manager when referring to the domain concept

**Legacy Manager Source Access**:
A temporary Manager-authoring capability over one raw Provider Source, isolated from every standing and Agent Task Authority path and measured only to support its retirement.
_Avoid_: Workspace Authority, Consumer Binding, Task Binding

**Agent Task Authority**:
The authority for one bounded Agent Task, materialized within Workspace Authority and limited to the approved Task Template ceiling; it may only preserve or reduce effective authority during that execution.
_Avoid_: Task workspace, parallel authority aggregate

**Agent Task**:
One bounded execution with its own authority identity inside a Workspace, distinct from the Chat history that may reference it.
_Avoid_: Chat turn, reusable session, standing Consumer

**Effective Workspace Principal**:
The one Workspace ownership or membership record on whose behalf an Agent Task is dispatched: exactly the owner profile and ownership generation or one member profile and membership generation. It cannot change during that task or through delegation.
_Avoid_: Agent Service identity, provider identity, Chat participant

**Pre-established Application Scope**:
An optional Workspace Authority-owned, generation-bound restriction record established by an earlier authority decision before dispatch. It may narrow one Agent Task to a supported application boundary but never supplies application Principals, tenant membership, or authority.
_Avoid_: Tenant authority, runtime-selected audience, Project, Environment, repository scope

**Task Authority Correlation**:
The immutable tuple of Agent Task identity/generation, Effective Workspace Principal reference/generation, and optional Pre-established Application Scope reference/generation carried across every Workspace-owned task authority and enforcement-correlation record. Provider Observation Evidence remains task-neutral and is referenced rather than rewritten.
_Avoid_: Chat ID, request ID, tracing context

**Agent Task Lease**:
The short, generation-tagged execution interval during which one nonterminal Agent Task may hold a Task Environment, bounded by the task's immutable absolute expiry.
_Avoid_: Agent Task lifetime, Chat session, Workload Attachment

**Task Checkpoint**:
A capability-free durable continuation record for one nonterminal Agent Task, bound to its task, lease, Task Environment, and Ratchet generations.
_Avoid_: Chat authority, stored RPC stub, reusable environment

**Task Delegation**:
The explicit parent-to-child request that may dispatch one fresh child Agent Task with independently materialized authority no broader than the parent's current effective authority.
_Avoid_: Ambient inheritance, subroutine call, shared Task Environment

**Task Template**:
A stable lineage for immutable Task Template Versions that describe the maximum authority of one class of Agent Tasks.
_Avoid_: Agent Task, mutable policy document, approved version

**Task Template Version**:
One complete immutable maximum-authority ceiling in a Task Template lineage, including exact Task Binding Requirements, duration, delegation, runtime-coverage, release, and Principal-eligibility constraints.
_Avoid_: Task Template Approval, Task Dispatch Decision, mutable revision

**Task Template Approval**:
One immutable Workspace decision accepting an exact Task Template Version and the exact Artifact Approval epochs it cites. Its lifecycle may later be deprecated or revoked, but its accepted ceiling is never edited.
_Avoid_: Artifact Approval, Task Dispatch Decision, runtime approval

**Task Consumer**:
The authority-recognized role of one Agent Task for the lifetime of that task. It receives only task Bindings placed by that task's Task Dispatch Decision and is never a standing Consumer identity.
_Avoid_: Agent Service, Workload, Chat, reusable Consumer

**Task Environment**:
The immutable, generation-tagged set of exact task Bindings, enforcement endpoints, mediators, deadlines, and egress materialized for one Agent Task.
_Avoid_: Ambient environment, Chat bindings

**Task Enforcement Mediator**:
A Workspace-owned adapter that accepts only a current Task Invocation Envelope, invokes one explicitly supported runtime or capability path, and withholds protected results until generation and release acknowledgement succeeds.
_Avoid_: Ambient tool wrapper, authorization cache, provider proxy

**Task Invocation Envelope**:
The immutable capability-free tuple authorizing one invocation under an exact Task, lease, Task Environment, Ratchet, Binding, operation, deadline, and cancellation generation.
_Avoid_: Request metadata, tracing context, reusable token

**Effective Authority Envelope**:
The normalized immutable value used at Template review, dispatch, environment publication, and Ratchet comparison to describe exact provider/resource and Upstream Authority identities, Artifact Approval epoch, operations, recipients, egress, release classes, sharing, enforcement profile, and maximum expiry.
_Avoid_: Permission bag, policy summary, provider-native scope

**Trust Ratchet**:
The monotonic discipline that may preserve or narrow an Agent Task's effective authority but never broaden, extend, or restore it.
_Avoid_: Scope reset, runtime approval

**Trust Ratchet Transition**:
One immutable, lineage-linked replacement of a Task Environment that retracts or narrows existing task Bindings and records permanently removed authority.
_Avoid_: Re-dispatch, permission edit, scope refresh

**Protected Observation**:
Provider Observation Evidence or a derived result held outside model context behind Workspace-owned task and generation correlation until release is allowed and every participating enforcement endpoint acknowledges the current Task Environment.
_Avoid_: Agent Activity, prompt content, untrusted model result

**Reviewed Declassification Decision**:
A human-reviewed decision to release one exact content-addressed Protected Observation to one recipient already allowed by the current task ceiling and Ratchet state. It changes data classification, never authority.
_Avoid_: Runtime Approval Decision, Task Template Approval, Binding

**Authority Manager**:
A named workspace member whom the owner has explicitly granted `manageAuthority`. An Authority Manager may make workspace authority decisions but gains no build rights from that permission.
_Avoid_: Builder, Admin

**Authority Session**:
An ephemeral RPC capability minted for the workspace owner or one Authority Manager and bound to that principal's authenticated session, current permission generation, and workspace authority epoch. It is a revocable façade over Workspace Authority, not a durable grant or decision.
_Avoid_: Login session, Authority Operation, permission record

**Authority Proposal**:
A requested change that would expand or redirect a Consumer's authority and therefore requires an Authority Manager's explicit decision before it takes effect.
_Avoid_: Approved change, automatic grant

**Artifact Proposal**:
One Workspace record pinning an exact Contract Artifact, Review Bundle, Review Comparison, policy snapshot, generator identity, and declared baseline for an Artifact Approval decision. It grants no installation or runtime authority, and Chat retains only a reference plus non-authoritative presentation snapshots.
_Avoid_: Artifact Approval, Installation Decision, chat code, build candidate

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
A stable cross-repository software scope inside one Workspace that groups Repository Claims, named Environments, Development Sessions, and Workloads.
_Avoid_: Repository, authority aggregate

**Repository Claim**:
Untrusted attributed provenance and discovery metadata asserting that a repository or subdirectory relates to a Project. A claim is never a Consumer identity or source of authority.
_Avoid_: Project identity, trusted repository

**Consumer**:
A canonical discriminated Binding recipient: a standing Gadget, Development Session, or Workload, or one task-scoped Agent Task acting as a Task Consumer.
_Avoid_: App when the distinction matters

**Development Session**:
A short-lived leased Consumer belonging to one Project and resolving one Environment for the lifetime of its lease.
_Avoid_: Local daemon, developer machine

**Development Session Grant**:
An Authority Manager's revocable authorization for one named developer to mint short-lived Development Sessions for one exact Project, Environment, and Binding Set version. It authorizes repetition within that fixed envelope, not new placement choices.
_Avoid_: Session, build permission, blanket development access

**Development Placement Template**:
An immutable, manager-approved placement envelope within a Development Session Grant that pins each requirement's Artifact Approval, Source, Authority Mode, and shared-state choice. It authorizes fresh per-Session installations only while every cited generation still matches.
_Avoid_: Contract Instance, reusable capability

**Development Lease**:
The bounded, renewable lifetime of one Development Session. Expiry invalidates that Consumer and every capability derived for it even if cleanup or an alarm runs later.
_Avoid_: Login session, transport connection

**Workload**:
A stable Project-owned Consumer whose deployed caller is authenticated by a trusted provider-specific identity adapter and resolves one Environment.
_Avoid_: Project ID, deployment claim

**Workload Registration**:
A workspace-owned, generation-bound mapping from one adapter-authenticated issuer and subject to one stable Workload. It records the deployment trust profile and credential lifecycle without treating deployment metadata as authority.
_Avoid_: Worker configuration, repository registration

**Workload Identity Evidence**:
A bounded, short-lived fact produced after an adapter verifies provider-specific transport evidence. It identifies an adapter, issuer, subject, assurance kind, and freshness but never a Project, Environment, Binding Set, or permission.
_Avoid_: Workload identity, authorization claim

**Workload Attachment**:
A transient capability session opened after Workload Identity Evidence matches a live Workload Registration. It carries one immutable generation snapshot and is not a durable Consumer or authority decision.
_Avoid_: Workload, deployment, Development Session

**Agent Service**:
A role and profile keyed one-to-one to one registered Workload that may execute approved Agent Tasks. It has no independent standing identity, Binding Set, Account, Source, or provider authority.
_Avoid_: Agent identity, service account, parallel Consumer

**Chat**:
A history and provenance record that may reference Agent Tasks but never stores reusable live authority.
_Avoid_: Task, authority boundary, capability session

**Environment**:
A stable, Project-owned authority target with a unique human-readable name, such as development, preview, or production. Branch names and deployment labels may suggest an Environment but never select one authoritatively.
_Avoid_: Deployment when referring to the authority configuration

**Environment Binding Requirement**:
A stable, versioned declaration within a Binding Set that names one standing capability, pins one Artifact Approval epoch, and constrains how Workspace Authority may select and verify its upstream authority.
_Avoid_: Task Binding Requirement, grant, environment variable

**Task Binding Requirement**:
A stable declaration within one immutable Task Template Version that names one capability and fixes its Artifact Approval epoch, Upstream Authority constraints, provider/resource/operation/recipient/egress ceiling, duration, sharing, runtime-coverage, release, and Authority Debt constraints.
_Avoid_: Environment Binding Requirement, ambient binding, runtime request

**Task Binding**:
A Binding whose Consumer is one Task Consumer, placed only by that task's Task Dispatch Decision and expiring no later than the Agent Task. It is never ambient, standing, or reusable by the Agent Service Workload.
_Avoid_: Workload Binding, Chat binding, copied capability

**Binding Requirement Reference**:
The exact reference from a Binding Resolution to either an Environment Binding Requirement version or a Task Binding Requirement in one Task Template Version.
_Avoid_: Binding name, inferred requirement

**Binding Set**:
A stable, versioned set of Environment Binding Requirements owned by one Environment and assigned explicitly to a standing Consumer. It is the Consumer's complete desired capability surface for that Environment.
_Avoid_: Ambient environment, inferred dependencies

**Authority Mode**:
The single resolution rule on an Environment Binding Requirement: `personal`, `shared`, or `verified`. Modes constrain Source eligibility and verification; they are not Source types and never define fallback order.
_Avoid_: Source type, automatic fallback

**Binding Resolution**:
Workspace Authority's canonical immutable placement result for one Consumer and one Binding Requirement Reference. It records the exact Upstream Authority, Artifact Approval, Installation Decision or Task Dispatch Decision, Contract Instance, applicable shared-state choice, and expected Binding generation.
_Avoid_: Candidate, best match

**Task Dispatch Decision**:
The immutable Workspace decision that authorizes exact placement for one Task Consumer after intersecting its approved Task Template Version with the initiating Principal, Agent Service Workload, resource-owner and organization policy, optional Pre-established Application Scope, current upstream health, and parent delegation.
_Avoid_: Installation Decision, runtime approval, chat continuation

**Verification Receipt**:
A bounded, expiring Gatekeeper result proving that one generation of a verifier principal independently satisfied a declared access check for one exact Provider Resource Identity.
_Avoid_: Permission grant, verifier capability

**Binding**:
The generation-tagged, uniquely named association through which one Consumer possesses the capability produced by one Contract Instance.
_Avoid_: Grant, permission

**Binding Enforcement Endpoint**:
The materialized, generation-acknowledged Contract Instance Facet through which one Binding's capability graph is invoked and synchronously invalidated.
_Avoid_: Raw Facet Fetcher, separate Binding authority store, Overseer dispatcher

**Invalidation Intent**:
A durable, generation-bound record that prevents republishing an old Binding while its Binding Enforcement Endpoint is being invalidated; it is not yet a completed revocation.
_Avoid_: Revocation, cleanup request

**Revocation Commit Point**:
The atomic Workspace transaction that, after every old-generation enforcement endpoint acknowledges invalidation, changes canonical authority, appends its Authority Events, and roots predecessor cleanup responsibility. This is the externally visible authority-status completion of local revocation or replacement.
_Avoid_: Invalidation request, provider cleanup, stub disposal

**Authority Debt**:
The reviewed difference between provider-native authority and narrower effective standing or task authority, preserving enforcement layer, revocation granularity, risk, exception owner, production eligibility, and remediation.
_Avoid_: Enforcement Gap, accepted risk, task scope, hidden provider scope

**Authority Event**:
An immutable, workspace-sequenced audit fact written atomically with the local authority decision or lifecycle transition it records. It is an audit projection of authority state, not an operational log or the source of truth.
_Avoid_: Log line, Source Action

**Source Activity**:
Task-neutral evidence that a Contract or Gatekeeper attempted or completed one provider-facing action or observation. Workspace Authority may reference it from task correlation records but never rewrites it as task authority.
_Avoid_: Authority Event, Agent Activity, operational log

**Agent Activity**:
Workspace-owned evidence of one Agent Task runtime, mediator, invocation, acknowledgement, or protected-result event carrying exact Task Authority Correlation. It is not an authority decision or provider record.
_Avoid_: Authority Event, Source Activity, prompt transcript, operational log

**Authority Operation**:
An idempotent causal group containing every Authority Event produced while carrying one requested change or recovery step across local state and external effects.
_Avoid_: Request ID, transaction

**Authority Effect**:
A durable, idempotent intent for one exact external step caused by a committed authority decision or lifecycle transition. An Effect records recovery responsibility but confers no authority by itself.
_Avoid_: Background job, remote transaction, Authority Operation

**Reconciliation**:
The system process that advances or repairs already-committed authority by comparing canonical facts, executing exact Authority Effects, and reducing ineligible authority. It never selects a new Source, changes an Authority Mode, or substitutes for an Authority Manager decision.
_Avoid_: Synchronization, auto-approval, best-effort healing

**Consumer Readiness**:
The generation-tagged result of evaluating one Consumer's exact Binding Set: all required requirements must have active eligible Bindings, while optional failures remain explicit diagnostics. Readiness never exposes a partial required capability environment.
_Avoid_: Deployment health, transport connectivity, loading state

**Authority Generation**:
A monotonic security epoch on an Account, grant, Source, Consumer, permission, Binding, or capability. A generation mismatch invalidates previously derived authority even when the stable identity is unchanged.
_Avoid_: Record revision, schema version, display version

**Graduation**:
Creation of Project-owned Contract Instances equivalent to a Gadget's approved bindings, with lineage back to the Gadget and without changing the Gadget's live security identity.
_Avoid_: Export, moving an instance

**Graduation Plan**:
An immutable reviewed translation from one exact Gadget authority snapshot into proposed Project, Environment, Binding Set, requirement, Consumer, and placement records. It confers no authority until its independent decisions and activation preconditions succeed.
_Avoid_: Gadget export, deployment plan

**Graduation Lineage**:
The immutable relationship between one captured Gadget binding and the Project requirement, resolution, Binding, and fresh Contract Instance created from it.
_Avoid_: Copy, ownership transfer

**Rollback**:
A fresh replacement installation that intentionally restores one previously used, still-eligible authority tuple and records both the current predecessor and historical target. It never resurrects a Contract Instance or rewinds history.
_Avoid_: Undo, restore instance
