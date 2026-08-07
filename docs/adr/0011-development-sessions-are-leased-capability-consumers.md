# Development Sessions are leased capability Consumers

A local development process receives a short-lived, generation-checked environment of Contract capabilities. It never receives a Source, external-provider credential, verifier capability, Contract policy, or authority decision interface. The foreground CLI and daemon are transport adapters around a workspace-owned Development Session, not a local authority implementation.

## Prototype verdict

The throwaway state-machine prototype exercised ready, reconnect, expiry, Retraction, ambiguity, and idempotent-replay paths. It validated three separations:

- durable Session lifecycle, binding readiness, and transient transport attachment are independent state dimensions;
- the environment contains only active Contract capabilities, while unresolved and optional conditions remain status diagnostics;
- reconnect resumes an existing live Consumer, while expiry or explicit disconnect requires a new Consumer identity.

It also exposed an ergonomics problem: requiring an Authority Manager to approve every 15-minute lease would make ordinary development unusable. Workspace Authority therefore has a `Development Session Grant`: an explicit, revocable decision authorizing one named developer to mint repeated leases for one exact Project, Environment, and Binding Set version. Its immutable Development Placement Template pins every Artifact Approval, Source, Authority Mode, and shared-state choice. The system may materialize fresh per-Session Installation Decisions from that exact template, citing the original manager decision; it cannot make another selection or proceed through a generation mismatch.

The prototype remains a primary-source artifact on branch `codex/prototype-leased-development-session`; its page state is illustrative, while this ADR is normative.

## Command experience

### `contractors login <workshop-url>`

The CLI generates an operation nonce and asks the public Workshop interface for a developer-login attempt. It opens the returned same-origin URL in the user's browser. The browser completes the deployment's existing authentication flow and explicitly approves that CLI attempt. The attempt capability resolves once with a CLI-scoped user session token; abandoning login disposes the attempt.

The token is audience-bound to `contractors-cli`, identifies one user at one deployment, and is stored only in the operating-system credential store. It is never written to the repository, shell history, environment definition, or daemon log. The token is a Workshop authentication credential, not an external-provider credential; all external credentials remain encapsulated by Gatekeepers. Revoking the user session or workspace permission invalidates subsequent RPC calls.

### `contractors dev`

The command requires an exact workspace, Project, Environment, and Binding Set version. Repository configuration may provide requested human-readable selectors, but the CLI resolves them through the Workshop and displays the authority-issued IDs and exact version before creation. An interactive caller confirms the tuple; a non-interactive caller must supply the stable IDs and version explicitly. Repository, branch, directory, deployment label, and package metadata never authenticate or select the Consumer.

Workspace Authority then follows this order:

1. authenticate the developer and live workspace build permission;
2. find a live Development Session Grant and exact Development Placement Template for that same principal and tuple;
3. create or idempotently return the Development Session under that Grant generation;
4. evaluate its pinned Binding Requirements without choosing ambiguous candidates or changing Authority Mode;
5. expose status immediately, but open a capability environment only when every required binding is active.

If no Grant exists, `dev` creates a bounded request for an Authority Manager and reports `grantRequired`; it does not self-approve. A manager grants the displayed tuple and exact placement template. Personal mode additionally requires a current user-owned Personal Source Grant for that developer. Each Session receives new Contract Instances and Installation Decisions causally authorized by the template; changed Approval, Source, mode, shared state, or generation requires a new Grant/template decision. Optional failures do not block the environment and appear as diagnostics.

`dev` is a foreground supervisor by default and may run a child command after `--`. It writes only a non-secret Session ID and exact tuple to the user's runtime directory, never the repository. Losing that file merely prevents convenient resume; it grants no authority.

### `contractors status`

Status shows the stable Session ID, immutable tuple, Development Session Grant generation, lease generation and expiry, readiness, environment generation, and each binding's required/optional state plus a typed reason code. It distinguishes `grantRequired`, `personalConsentRequired`, `noCandidate`, `ambiguous`, `verificationDenied`, `verificationIndeterminate`, `credentialAttentionRequired`, `credentialUnknown`, `staleDecision`, `suspended`, `retracted`, and `optionalUnavailable`.

Status never lists raw Provider identities, Source or verifier capabilities, candidate credentials, policy bodies, or the Authority Event stream. When no foreground daemon exists, it obtains the same bounded snapshot through the authenticated Workshop interface using the non-secret Session ID.

### `contractors disconnect`

Disconnect is an idempotent terminal mutation. It checks the authenticated principal, Session ID, expected Consumer generation, and operation request digest; increments the Consumer generation; marks the lease disconnected; retracts its Bindings and Contract Instances locally; appends the state events in the same transaction; and then drives cleanup effects. The CLI disposes all local stubs and deletes its runtime pointer even when remote cleanup remains pending.

## Lease and reconnect protocol

Version 1 leases last 15 minutes. The foreground CLI requests renewal every five minutes and whenever less than ten minutes remain after reconnect. Renewal preserves the Session identity, increments the lease generation, and extends expiry only when the developer, build permission, Development Session Grant generation, immutable tuple, and Consumer generation still match. It does not reactivate a Binding, select a Source, extend verification evidence, or widen authority.

Expiry is effective at the persisted `expiresAt`, not when a cleanup alarm happens. Every leased Contract bridge checks Session, Grant, Consumer, Binding, and relevant Source/verification generations plus the current expiry before forwarding a call. A delayed alarm therefore cannot extend authority.

The workspace schedules its alarm for the earliest live lease expiry, expires due Sessions in bounded batches, appends events atomically with local Retraction, and reschedules itself. Stale alarms and already-terminal Sessions are no-ops. Cleanup retries use their original Authority Operation and can never restore local authority.

A transport failure is not a durable lifecycle transition and emits no Authority Event. The CLI immediately disposes its local root and binding stubs, reconnects the authenticated Workshop WebSocket, and calls resume with the non-secret Session ID, exact tuple, and last observed generations. Resume succeeds only before expiry for the same authenticated developer and live Grant. It returns the same Session identity. After expiry or disconnect, resume returns a typed terminal result and `dev` may request a new Session under the still-live Grant.

Multiple transports do not create more authority: they are attachments to the same Consumer and generations. Disconnect, expiry, permission loss, Grant revocation, Source retirement, or Binding replacement invalidates every attachment.

## Cap'n Web seam

The public shared interface adds three small modules. Every exported member receives a doc comment in implementation.

```ts
interface AuthenticatedApi {
  openDevelopment(workspaceId: string): Promise<RpcStub<DevelopmentApi>>;
}

interface DevelopmentApi extends RpcTarget {
  startSession(request: StartDevelopmentSession): Promise<RpcStub<DevelopmentSession>>;
  resumeSession(request: ResumeDevelopmentSession): Promise<RpcStub<DevelopmentSession>>;
  getSessionStatus(sessionId: string): Promise<DevelopmentSessionStatus>;
}

interface DevelopmentSession extends RpcTarget {
  getStatus(): Promise<DevelopmentSessionStatus>;
  subscribeStatus(callback: RpcStub<DevelopmentStatusSubscriber>): Promise<RpcStub<{}>>;
  openEnvironment(expectedEnvironmentGeneration: number): Promise<RpcStub<DevelopmentEnvironment>>;
  renew(request: RenewDevelopmentLease): Promise<DevelopmentLeaseStatus>;
  disconnect(request: DisconnectDevelopmentSession): Promise<void>;
}

interface DevelopmentEnvironment extends RpcTarget {
  getBindings(): Promise<DevelopmentBindingEnvironment>;
}
```

`openDevelopment()` returns a capability scoped to one workspace and live build permission; it exposes no authority-management methods. Calls can be promise-pipelined from the returned `DevelopmentApi` and `DevelopmentSession` promises. Stable Authority Operation IDs, idempotency keys, request digests, expected revisions, and generations are carried by mutation request objects.

`openEnvironment()` succeeds only for a ready snapshot and exact environment generation. `getBindings()` returns a named record of generation-tagged Contract `RpcStub`s and public type identities. It never returns Sources. A readiness or Binding-generation change invalidates the entire immutable environment snapshot; clients obtain a new one rather than silently retaining a mixed-generation map.

The local daemon transparently bridges Cap'n Web frames between the local process and this environment capability. It may authenticate, renew, reconnect, expose status, and manage stub lifetimes. It cannot call Gatekeepers, evaluate Contract policy, choose candidates, translate a raw Source into a binding, or obtain `AuthorityApi`.

## Generated TypeScript and ownership

The CLI generates a gitignored declaration file from the exact Binding Set version and pinned Artifact Approval public declarations, not from live Source data. Required names are non-optional; optional names are optional. Binding names must already be valid unique TypeScript property names under the Binding Set rules.

```ts
export interface DevelopmentEnvironmentBindings {
  readonly storage: RpcStub<R2Bucket>;
  readonly issues?: RpcStub<GitHubIssues>;
}
```

The generated runtime's `connect()` returns an owner object containing that typed binding map and a `[Symbol.dispose]` implementation. It owns the environment root and every returned Contract stub. It disposes them all on explicit disposal, child-process exit, HMR replacement, transport loss, environment invalidation, Retraction, expiry, or disconnect. Reconnect always obtains fresh stubs; a stale callable object is never placed back into application state.

The daemon maintains no durable policy cache. It may retain the current bounded status and exact type artifact for display, keyed by Session/environment generation, and discards both on mismatch. Server state remains authoritative.

## Durable state and events

The Development Session Consumer stores the named principal, exact Project/Environment/Binding Set version, Development Session Grant ID/generation, Consumer and lease generations, issue/expiry, lifecycle, environment generation, CAS revision, and last operation. Transport attachment is transient and is not stored as Session lifecycle.

Session creation, Grant assignment/revocation, lease renewal, expiry, explicit disconnect, Binding Set assignment, readiness changes, and Retraction emit bounded Authority Events only when durable state changes. Idempotent replay and ordinary transport loss/reconnect emit no event. A reconnect denial emits an event only when it accompanies a newly committed terminal or blocked state; repeated denials are operational logs.

## Considered options

- Treating repository configuration as Session identity was rejected because a checkout is untrusted and copyable.
- Returning Sources to the daemon was rejected because it would move policy interpretation and credentials outside Workspace Authority.
- Requiring a fresh Authority Manager decision for every lease was rejected because short fail-closed leases would become unusable; the exact, revocable Development Session Grant preserves human control without approving each renewal.
- Reusing a Session identity after expiry was rejected because it makes lease expiry cosmetic and complicates audit lineage.
- Mutating a live environment map in place was rejected because callers could unknowingly retain a mixture of old and new generations.
- Keeping a daemon-side policy or credential cache was rejected because offline local authority cannot observe immediate revocation.

## Consequences

Local development gets a concrete login/dev/status/disconnect experience, fast reconnect, strong TypeScript names, and bounded leases. Workspace Authority retains every authority choice and can revoke all attachments synchronously through generations.

Implementation requires a CLI device-login flow, a small Development API seam, generation-checking Contract bridges, an OS-credential-store adapter, a transparent local Cap'n Web bridge, and alarm-driven lease cleanup. The first slice can implement only the R2 requirement while preserving the same interface and state machine.
