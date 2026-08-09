# Authority administration is a revocable capability

Workspace authority administration uses a separately opened, workspace-scoped `AuthorityApi`, not the existing `Overseer`, generic build/use access, deployment `AdminApi`, or an ambient method set on `AuthenticatedApi`. The returned Authority Session is bound to one authenticated principal, the current `manageAuthority` grant generation or implicit owner status, and the workspace authority epoch. Every operation revalidates that binding, while durable decisions and recovery remain inside the workspace Durable Object.

## Capability graph

The public graph has five deliberately disjoint roots:

```text
PublicApi
└─ AuthenticatedApi
   ├─ openGadget(workspace) ────────────── Overseer or use-only Overseer
   ├─ openWorkspaceProposals(workspace) ─ WorkspaceProposalApi (live build permission)
   ├─ openDevelopment(workspace) ──────── DevelopmentApi (live build permission)
   ├─ openPersonalSourceConsent(workspace) PersonalSourceConsentApi (that user only)
   └─ openAuthority(workspace) ─────────── AuthorityApi (owner or live manageAuthority)
                                              └─ openOwnerControl() ─ AuthorityOwnerApi (owner only)

WorkloadConnector.attach() ─────────────── WorkloadAttachment (provider evidence only)
```

`openAuthority(workspaceId)` asks the workspace Durable Object to mint the root after checking the authenticated profile, owner identity or active named-member grant, grant generation, authentication session, workspace authority epoch, and active schema writer version. It returns one generic `authorityUnavailable` denial for missing workspaces and unauthorized callers so it does not become a metadata oracle. `AuthenticatedApiImpl` only transports the authenticated identity and session revoker; it never implements or forwards individual authority decisions.

`AuthorityApi` does not imply `build` or `use`. An Authority Manager with no collaborator role can inspect bounded authority state, evidence, and audit history and can decide proposals. Conversely, a builder cannot obtain `AuthorityApi`. Deployment-wide `AdminApi` remains unrelated: deployment admins are not workspace Authority Managers unless the workspace owner grants them that permission.

The API never accepts another `AuthorityApi`, `AuthorityOwnerApi`, or authenticated-principal stub as an argument. Cap'n Web capabilities can technically be forwarded by a malicious authorized client, just as authentication credentials can be shared, but the product exposes no delegation path and records no transitive grant. Every durable actor remains the named principal for whom the session was minted.

## Shared RPC modules

Implementation adds focused `workshop-shared` modules instead of expanding the existing monolithic API with every domain record:

- `authority-api.ts`: the capability interfaces, closed command/query unions, views, expected-failure unions, pagination, and common command envelope;
- `authority-events.ts`: event envelopes, filters, pages, and subscriber callback types;
- `authority-evidence.ts`: bounded Review Bundle and Review Comparison reader types;
- `development-api.ts` and `workload-api.ts`: the already-decided narrower Consumer seams.

`api.ts` re-exports their public entry interfaces. Every exported type, constant, function, and interface member has a doc comment. Backend implementations implement or derive from the exported interfaces directly; they do not maintain hand-written mirror types or bridge them with `as unknown as` casts.

All incoming values are runtime-validated as closed schemas before normalization. Unknown fields, unsafe integers, invalid IDs, oversized collections, prototype-bearing records, and unsupported discriminants fail before storage. TypeScript is developer assistance, not an input trust boundary.

## `AuthorityApi`

The root stays small. It returns bounded data views; only review readers, subscriptions, and owner control are further capabilities.

```ts
interface AuthenticatedApi extends RpcTarget {
  openAuthority(workspaceId: string): Promise<RpcStub<AuthorityApi>>;
  openWorkspaceProposals(workspaceId: string): Promise<RpcStub<WorkspaceProposalApi>>;
  openPersonalSourceConsent(workspaceId: string): Promise<RpcStub<PersonalSourceConsentApi>>;
}

interface AuthorityApi extends RpcTarget {
  getSnapshot(request: AuthoritySnapshotRequest): Promise<AuthoritySnapshot>;
  query(request: AuthorityQuery): Promise<AuthorityQueryPage>;
  beginOperation(request: BeginAuthorityOperation): Promise<AuthorityOperationView>;
  execute(command: AuthorityCommand): Promise<AuthorityCommandResult>;
  getOperation(operationId: string): Promise<AuthorityOperationView>;
  openReviewEvidence(request: OpenReviewEvidenceRequest):
      Promise<RpcStub<ReviewEvidenceReader>>;
  queryEvents(request: AuthorityEventQuery): Promise<AuthorityEventPage>;
  subscribeEvents(request: SubscribeAuthorityEvents,
      subscriber: RpcStub<AuthorityEventSubscriber>):
      Promise<RpcStub<AuthorityEventSubscription>>;
  openOwnerControl(): Promise<RpcStub<AuthorityOwnerApi> | null>;
}
```

`getSnapshot()` returns one revisioned overview suitable for initial UI rendering: Projects/Environments, Consumer readiness counts, pending proposals/operations/effects, Account and Source health counts, and the event high-water mark. It is a bounded summary, not an authority cache.

`query()` accepts a closed discriminated union with these families:

- Project, Repository Claim, Environment, Binding Set/version, Requirement/version, assignment, candidate, Resolution, and readiness;
- Workspace Account, Personal Source Grant reference, Source, Credential Health, verification receipt, and cleanup status;
- Artifact Proposal, Approval epoch, Review Bundle metadata, Installation Proposal/Decision/attempt, Contract Instance/tombstone, and Binding;
- Gadget, Development Session Grant/template/Session, Workload/Registration/rotation, and Attachment status;
- Graduation Plan/item/lineage, Rollback, Authority Operation, and Authority Effect.

Every query is explicitly paginated and capped, uses stable domain IDs, and returns revisions, Authority Generations, immutable versions/epochs, lifecycle, exact hashes, safe fingerprints, and bounded typed diagnostics. It never returns a Gatekeeper Account, Source, verifier, lifecycle sink, grant revoker, Contract policy, provider credential, raw provider key, numeric facet locator, staged migration row, or callable Consumer capability. Candidate views are facts for a manager to decide; they do not authorize selection.

`AuthorityCommand` is a closed union rather than a broad key/value mutation API. Its variants cover:

- Project, Repository Claim, Environment, Binding Set/version, Requirement/version, and Consumer assignment decisions;
- Workspace Account connection/reconnect/suspension/retirement and Source derivation/suspension/reactivation/retirement;
- Artifact Proposal review and Approval approve/reject/deprecate/revoke;
- Installation Proposal decision, replacement, Rollback, suspension/reactivation, Retraction, and exact Binding publication;
- Development Session Grant and Development Placement Template issue/revoke/expire;
- Workload creation/assignment and Registration create/suspend/rotate/finalize/abort/replace/retire;
- Graduation Plan capture/review/submit/rebase/prepare/activate/abort;
- explicit verification requests and bounded cleanup/retry/abandon decisions where a human choice is required.

There is no generic patch, arbitrary record write, raw effect completion, or `reconcileAsManager` command. Internal adapters and reconciliation have separate non-public entrypoints and can only observe facts, complete committed exact effects, preserve eligible authority, or reduce authority.

## Operations, commands, and failures

The common mutation envelope is:

```ts
type AuthorityCommandEnvelope = {
  operationId: string;
  stepKey: string;
  requestDigest: string;
  expectedAuthorityEpoch: number;
  expectedPermissionGeneration: number;
  expected: AuthorityPreconditions;
};
```

For a manager, `expectedPermissionGeneration` is the Authority Grant generation; for the owner, it is the ownership generation. Each command variant adds its complete typed payload. `AuthorityPreconditions` contains every relevant record revision, Authority Generation, immutable version/epoch, expected Binding generation, and evidence hash. Omitting a relevant precondition is invalid rather than "latest wins".

`beginOperation()` is idempotent on `(actor principal, idempotency key)`, stores a canonical root request digest, and returns the same authority-issued Operation ID for an exact retry. The server recomputes all canonical digests from normalized closed-schema inputs; client-supplied digests are assertions, never trusted values. A step is idempotent on `(operationId, stepKey)`. Reusing an operation or step with another digest is `idempotencyConflict`.

This shape supports Cap'n Web promise pipelining without turning an operation into another long-lived stub:

```ts
using authority = authenticated.openAuthority(workspaceId).dup();
using operation = authority.beginOperation(beginRequest);
const result = await authority.execute({
  ...command,
  operationId: operation.id,
});
```

The operation promise may be passed directly into later request fields. Pipelining changes round trips only: authorization, runtime validation, normalization, evidence checks, and transaction preconditions still execute in order on the server. A combined UI confirmation pipelines two commands under one Operation, but Artifact Approval and Installation Decision remain different command variants, records, actors, request digests, and event sequences.

Expected domain failures are discriminated results: `authorityRevoked`, `notFound`, `stale`, `idempotencyConflict`, `invalidLifecycle`, `blocked`, `noCandidate`, `ambiguous`, `verificationDenied`, `verificationIndeterminate`, `evidenceUnavailable`, `pendingEffect`, and `terminal`. Malformed RPC inputs and internal faults reject the call. An RPC disconnect is neither success nor failure: callers reopen the root and use `getOperation()` or replay the exact step to learn the durable result.

The narrow storage writer recomputes the actor from the Authority Session, never from command fields, then checks the live session/grant/epoch and all command preconditions in the same transaction that stores the result and contiguous Authority Events. External work returns a persisted pending Effect reference. Only an internal outcome method can complete that Effect, and it rechecks the committed decision plus current safety generations.

Revoking a manager prevents uncommitted decisions and new steps. It does not retroactively erase an Artifact Approval, Installation Decision, Registration, or other decision that committed under the live grant. Reconciliation may finish an already-committed exact effect after the actor loses permission; changing its tuple requires another live manager decision.

## Revocation and session lifecycle

An Authority Session captures:

- authenticated principal and authentication-session generation;
- owner identity/ownership generation, or Authority Grant ID and grant generation;
- workspace authority epoch and schema writer version;
- one server-side revocation cell shared by its root, owner-control child, evidence readers, and subscriptions.

Every public method begins with the same non-overridable guard. Mutation guards are repeated inside `AuthorityStore.mutate()` immediately before commit. Read methods guard and capture their snapshot without yielding between authorization and local storage access. Evidence readers guard every page, blob open, and stream pull. Event subscriptions guard every delivery.

Grant revocation commits the terminal grant state and generation increment before invalidating matching in-memory cells and subscriptions. A Durable Object restart may lose that in-memory registry, but durable generation checks still reject the next call. Calls serialized before the revocation transaction may commit; calls after it cannot. A call that started earlier but reaches its commit guard later fails stale. This is the precise immediate-revocation boundary.

Workspace restart, WebSocket loss, authentication-session revocation, or explicit disposal breaks the ephemeral root and all children without changing durable authority state. The client disposes old stubs, reconnects, calls `openAuthority()` again, and resumes through stable IDs and Operations. An Authority Session itself is never persisted or resumed by ID.

The existing whole-workspace restart used for collaborator-role revocation is not reused for `manageAuthority`; authority revocation must not disconnect unrelated Gadget users, Development Sessions, or Workload Attachments. Consumer bridges independently enforce their own generations.

## Owner control and recovery

`openOwnerControl()` returns null for a manager and a separate generation-checked capability for the current owner:

```ts
interface AuthorityOwnerApi extends RpcTarget {
  getManagerGrants(request: AuthorityGrantQuery): Promise<AuthorityGrantPage>;
  execute(command: AuthorityOwnerCommand): Promise<AuthorityOwnerCommandResult>;
}
```

The owner command union contains only grant, revoke, workspace-authority-epoch rotation, and emergency local Retraction. A manager cannot call these through `AuthorityApi.execute()`.

The owner is implicit and does not depend on an `authorityGrants` row, so they can always recover administration through a newly authenticated session. Rotating the workspace authority epoch invalidates every minted Authority Session, including the caller's, and cancels undecided/draft operation steps; the owner then reopens a fresh root. It does not silently alter already-committed approvals, placements, or Bindings.

Emergency Retraction is a distinct destructive command with an exact scope and preview digest. It first increments affected local generations and retracts selected or all Consumer Bindings/instances in the workspace transaction, then schedules provider cleanup. It never waits for remote success and never rewrites audit history. Epoch rotation is access recovery; Emergency Retraction is authority removal, and the UI cannot conflate them.

Ownership transfer, if introduced, must increment the ownership generation and workspace authority epoch, invalidate all manager sessions, and require the new owner to decide which grants survive. Version 1 need not expose transfer merely to implement this API.

## Builder, user, and Consumer seams

`WorkspaceProposalApi` is bound to one authenticated principal and current build permission. It exposes only:

```ts
interface WorkspaceProposalApi extends RpcTarget {
  submitArtifact(request: SubmitArtifactProposal): Promise<ProposalStatus>;
  requestInstallation(request: RequestInstallationProposal): Promise<ProposalStatus>;
  requestDevelopmentGrant(request: RequestDevelopmentGrant): Promise<ProposalStatus>;
  getStatus(request: ProposalStatusRequest): Promise<ProposalStatus>;
  withdrawDraft(request: WithdrawProposalDraft): Promise<ProposalStatus>;
}
```

`submitArtifact()` carries original authoring modules and typed origin to the trusted build path; it cannot submit a client-trusted executable. `requestInstallation()` names the intended Consumer/Environment/Requirement and desired binding but cannot select a hidden Source, approve an Artifact, create an Installation Decision, or publish a Binding. Builders see their bounded proposal state and safe readiness diagnostics, not candidates, provider identities, full evidence, or Authority Events. Removing build permission invalidates this root and any in-flight uncommitted request.

`PersonalSourceConsentApi` is implemented by the user's Durable Object and scoped to that user and workspace:

```ts
interface PersonalSourceConsentApi extends RpcTarget {
  listRequests(request: PersonalConsentQuery): Promise<PersonalConsentPage>;
  decide(request: PersonalConsentDecision): Promise<PersonalConsentStatus>;
  getStatus(request: PersonalConsentStatusRequest): Promise<PersonalConsentStatus>;
  revoke(request: RevokePersonalConsent): Promise<PersonalConsentStatus>;
}
```

It acts only on an opaque workspace request for one exact Provider Account/Resource Identity and scope. The Authority Manager may create or cancel that request and see bounded status, but cannot invoke consent, choose the user's account, renew it, or receive the Personal Account capability. The User Durable Object records the user's separate idempotent decision, derives/transfers only the generation-bound Source internally, and reports the outcome to Workspace Authority under the correlated Operation. Revocation is locally effective in the User DO first and then drives workspace Retraction.

Workspace Account connection is a third flow, not a misuse of personal consent. An Authority command first records a connection intent and asks the Gatekeeper to start its authority-account flow with a core-only, operation-bound callback. The browser may receive an OAuth URL and bounded attempt status, but the Gatekeeper delivers the resulting Account capability directly to that callback; it never crosses `AuthorityApi`. Reconnect completes only after the callback reports an exact Provider Account Identity comparison. Same identity advances the capability generation, while mismatch returns a typed `identityMismatch` proposal requiring a new Account path. Verification requests likewise return only `verified | denied | indeterminate`, receipt metadata, and bounded reason codes; verifier capabilities and evidence remain core-only.

Use-only `Overseer`, Gadget UI, `DevelopmentApi`, `DevelopmentSession`, `WorkloadAttachment`, and Contract environments expose current readiness, binding names/public types, generations needed to detect invalidation, and bounded diagnostics relevant to that caller. They never expose the authority audit stream, candidate lists, Approval evidence, Sources, verifier capabilities, decision methods, or an `AuthorityApi` acquisition path.

## Evidence and event capabilities

`ReviewEvidenceReader` provides manifest metadata, paginated comparison sections, and exact content-addressed blobs as guarded byte streams. Blob responses include the expected hash, length, and media type; the reader verifies them before and during delivery. It never returns an R2 URL or storage capability. Disposal or authority revocation cancels outstanding reads.

Event queries use workspace sequence cursors, return a high-water mark, and cap pages at 200. The subscriber callback receives ordered bounded batches and current high-water mark; delivery is at-least-once, and clients deduplicate by sequence. The returned `AuthorityEventSubscription` owns cancellation. Revocation closes it before any later event is delivered. Consumer/build/use APIs receive current status only, never a filtered event stream.

## Stub ownership

Clients explicitly own every returned root, owner-control child, reader, subscription, result containing stubs, and unawaited RPC promise. They use `using` where possible or call `[Symbol.dispose]()` on unmount, navigation, transport loss, replacement, and reconnect. Passing a callback stub into a call does not transfer the caller's ownership; the caller disposes its copy after canceling the returned subscription. A React state value containing any stub is wrapped in a non-callable object so the state setter does not invoke it.

`onRpcBroken()` is a transport signal only. It triggers disposal and reopen/status lookup; it never marks an Operation failed, retries a non-idempotent command under a new key, or infers revocation reason.

## Considered options

- Adding authority methods to `Overseer` was rejected because build/use and authority administration are orthogonal and have different revocation scopes.
- Reusing deployment `AdminApi` was rejected because deployment administration does not imply authority over every workspace.
- Checking `manageAuthority` only when minting the stub was rejected because a forwarded or long-lived stub would survive revocation.
- Restarting the whole workspace Durable Object on manager revocation was rejected because unrelated Consumers and users should not be disconnected.
- Returning Gatekeeper/Source/verifier stubs to the authority UI was rejected because administration decides bounded records; core capabilities remain encapsulated.
- One giant method per domain mutation was rejected in favor of a closed command union and one guarded writer seam, limiting kernel surface while retaining exhaustive typed variants.
- A generic JSON patch command was rejected because it cannot encode actor, lifecycle, generation, evidence, and placement invariants safely.
- Persisting Authority Sessions was rejected because durable identity belongs to grants, decisions, and Operations; transport capabilities are ephemeral.
- Treating manager revocation as revocation of every prior decision was rejected because decision authority is historical and explicit; owners must revoke the actual Approval, placement, Registration, or Binding they intend to remove.

## Extended Authority amendment (ADR 0023)

The same revocable Authority Session gains bounded Template, dispatch, task, Ratchet, protected-result,
evidence, and operations commands/queries; it never returns raw Sources or live task authority. The
older Emergency Retraction sentence's local-transaction-first ordering is superseded: retraction
persists an Invalidation Intent, invalidates and acknowledges every participating endpoint, commits
the canonical terminal generation at ADR 0020's Revocation Commit Point, then schedules provider
cleanup. Epoch rotation remains administration recovery and does not create or restore authority.

## Consequences

Authority administration becomes separately obtainable, immediately revocable, promise-pipelining-friendly, and recoverable after any transport or Durable Object restart. Builders, personal account owners, Workloads, Development Sessions, and use-only collaborators each retain a narrower seam with no path to authority administration.

Implementation adds runtime-validated shared unions and a small generation-checked façade in the workspace Durable Object. It must route every mutation through `AuthorityStore.mutate()`, guard evidence and subscriptions continuously, preserve durable operation results across disconnects, and keep previously committed decisions distinct from the permission of the person who made them.
