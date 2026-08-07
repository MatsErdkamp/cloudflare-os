# Gatekeeper authority is identity- and generation-bound

Workspace Authority integrates with Gatekeepers through a versioned, opt-in authority protocol that exposes stable provider identity, revocable generation-bound capabilities, bounded health evidence, and typed verification results without exposing credentials. Display metadata, URLs, callback possession, and a successfully restored RPC stub are never identity proof. Gatekeepers that do not implement the protocol remain available to existing Gadget flows but cannot provide new Project, shared, or verified authority.

## Authority support declaration

A Gatekeeper vendor advertises an `authorityProtocol` declaration alongside its existing description. Version 1 declares:

- whether it can back Personal Accounts, Workspace Accounts, or both;
- whether a Workspace Account connection is interactive or deployment-provisioned;
- stable Account and resource identity support;
- supported verifier principal kinds (`human` and, where explicitly implemented, `service`);
- health-notification and local-first revocation support.

The declaration describes mechanics only. It does not auto-provision a Workspace Account, assert ambience, classify a particular connection as workspace-owned, or override deployment policy. Existing `autoProvisionsAccount` continues to describe per-user account provisioning and never implies workspace ownership.

Workspace Account creation uses a distinct vendor entrypoint and callback from personal `connectAccount()`. Interactive setup may be driven by an Authority Manager, but the returned account is owned by Workspace Authority rather than the initiating user's User DO. A vendor may return workspace eligibility evidence; Workspace Authority makes and records the ownership decision.

## Stable identity

An authority-capable Account returns an immutable protocol snapshot containing:

- `identity`: protocol version, bounded provider issuer, stable provider-issued subject, and an audit-safe fingerprint;
- `capabilityGeneration`: a Gatekeeper-monotonic generation for the credential/capability set;
- `health`: status, reason code, observation time, optional credential expiry, and optional evidence validity deadline;
- supported resource declarations and verifier principal kind.

Provider Account Identity is `(vendorId, issuer, subject)`. The subject must come from authenticated provider state, remain stable across display-name and credential changes, and be non-secret; email, username, UI label, and Workshop account ID are not substitutes. The audit fingerprint is safe to retain in Authority Events but is not itself identity.

Resolving a user-supplied resource locator returns a scoped source capability and immutable Provider Resource Identity `(vendorId, issuer, resourceType, resourceKey)`. The resource key comes from authenticated provider state, not URL parsing alone. Canonical URL, title, snippet, and suggested binding name remain display metadata. Re-resolving a locator to a different identity is a mismatch, never an in-place retarget.

Workspace Authority issues all local Account, Source, and generation IDs. Gatekeepers receive only opaque authority handles, expected generations, lifecycle callback capabilities, and idempotent Authority Operation IDs; they do not parse workspace, Project, Consumer, or user identity from those handles.

## Derived Source capabilities

The authority Account exposes one derivation operation that accepts an opaque authority handle and generation, resource locator, lifecycle sink, and Authority Operation ID. Its authority kind is either:

- `personalGrant`: called by the owning User DO after explicit Personal Source Grant consent; or
- `workspaceAccount`: called by Workspace Authority for a Workspace Account it owns.

For a personal grant, the User DO retains the grant revoker and passes Workspace Authority only the exact derived source capability, Provider identities, grant generation, and bounded display metadata. Workspace Authority never receives the Personal Account capability. For a Workspace Account, Workspace Authority retains both the account and derived source capabilities.

The returned source snapshot binds Provider Account Identity, account capability generation, Provider Resource Identity, opaque authority handle/generation, Source capability generation, TypeScript root type, and type-declaration hash. Every source-session creation requires the expected tuple. An authority-capable Gatekeeper must make already-minted sessions fail after Account, grant, or Source generation invalidation; adapters may implement this with a revocable membrane or generation checks, but checking only when the session is first created is insufficient.

Source capabilities, Account capabilities, grant revokers, lifecycle sinks, and verifier capabilities are core-only. Consumers receive only Contract capabilities. Type and identity checks happen before an Installation Proposal can be approved.

## Credential Health and identity continuity

Credential Health has exactly three non-terminal states:

- `healthy`: positive evidence for the reported capability generation, optionally bounded by a validity deadline;
- `unknown`: the Gatekeeper cannot currently make a positive credential claim, usually because identity or provider state could not be checked;
- `attentionRequired`: known credential expiry, revocation, or insufficient scope requires repair.

Retired and identity-mismatch are Account lifecycle states, not health states. `attentionRequired` suspends dependent Sources and Contract bindings. `unknown` is never positive evidence for a new resolution; its treatment of existing sessions after evidence staleness is defined by reconciliation policy. Ordinary provider outages and operation failures remain operational errors unless they change reported health.

Health reports carry the Provider Account Identity, capability generation, Gatekeeper-monotonic report sequence, observed time, bounded reason code, and optional expiry/validity time. The Account owner supplies an unforgeable lifecycle callback capability. It rejects wrong-identity, wrong-generation, and out-of-order reports and treats duplicates idempotently. Personal Account health is first committed in the User DO and then fanned out to every active Personal Source Grant; Workspace Account health is committed directly by Workspace Authority.

Reconnect obtains a fresh authenticated identity snapshot. If Provider Account Identity matches, the owner accepts the new capability generation, invalidates old source sessions, and re-derives or reactivates the same Sources under normal policy. If it differs, the owner records identity mismatch and keeps the old Account and Sources suspended; it never overwrites the identity. The replacement must be connected as a new Account and every desired Source/installation reconsidered explicitly.

## Verification protocol

An authority-capable Account can mint a typed verifier capability whose snapshot binds Provider Account Identity, verifier principal kind, and capability generation. Workspace Authority passes it only to an authority Source from the same vendor. The Source performs the exact adapter-defined resource or observed-set check and returns one of:

- `verified`: a receipt ID and evidence digest bound to the exact Provider Resource Identity, Source and grant generations, verifier identity/generation, check kind, issue time, and expiry;
- `denied`: a bounded reason code proving the check completed negatively; or
- `indeterminate`: a bounded transient/protocol reason and optional retry time, conveying no authority.

Expected negative and transient outcomes are values, not exception text. Transport failure maps to `indeterminate`. Workspace policy caps receipt lifetime; a Gatekeeper may choose a shorter expiry. Best-effort invalidation callbacks accelerate revocation, but expiry and generation checks are the fail-safe. A receipt is data, not a capability, and is valid only for the exact Binding Resolution tuple that cites it.

`service` verifier principals require a provider-specific credential and verification implementation. Workload authentication, repository claims, or deploy metadata alone cannot mint one. Existing `GatekeeperUserVerifier` plus `addObserver()` remains the legacy collaborator protocol and is not treated as a durable Verification Receipt.

## Local-first revocation and cleanup

Grant, Source, and Account revoke/retire operations take expected identity/generation and an Authority Operation ID and are idempotent. The owning authority first makes the lifecycle transition terminal and increments or invalidates its local generation; Workspace Authority retracts dependent Contract capability graphs; remote revocation and cleanup then run as retryable external effects. For personal grants, the User DO also invokes the Gatekeeper-held grant revoker so stale Workspace communication cannot leave the derived Source usable.

Gatekeepers return typed cleanup outcomes (`complete`, `pending`, `unsupported`, or `failed` with a bounded reason code) and must treat a repeated operation as the same cleanup. Failure never restores local authority. Late health, reconnect, source, or verification callbacks for invalidated generations are ignored and audited.

## Compatibility

Legacy Gatekeepers without `authorityProtocol` continue to support existing personal Gadget bindings and their historical `credentialsExpired()` / `credentialsRestored()` and observer behavior. `AccountDescription.uniqueName`, `ResourceDescription.url`, and legacy creation specs may seed display and migration records, but cannot prove Provider identity. Such records are marked legacy/identity-unverified and are ineligible for new Project or Workload installation, shared/verified mode, or graduation reuse until the user reconnects through an upgraded Gatekeeper and explicitly reviews the resulting identity-bound Source.

Auto-provisioned first-party Gatekeepers such as R2 may establish stable identities from deployment-controlled opaque IDs rather than an external provider, but must implement the same snapshots, generations, lifecycle, verification outcomes, and revocation guarantees.

## Consequences

- `workshop-shared` needs fully documented, exhaustively typed protocol declarations, snapshots, result unions, callbacks, and capability interfaces.
- Gatekeeper conformance tests must prove stable identity across reconnect, mismatch refusal, out-of-order callback rejection, generation invalidation of live sessions, idempotent cleanup, bounded results, and no raw-capability escape.
- Existing Gatekeepers can migrate independently because protocol support is explicit and legacy behavior remains isolated.
- Persistence and reconciliation can reason about Account, Source, consent, health, and verification without inspecting credentials or vendor-specific verifier methods.
