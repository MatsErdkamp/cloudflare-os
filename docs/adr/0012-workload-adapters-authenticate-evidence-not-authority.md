# Workload adapters authenticate evidence, not authority

The first production Workload identity profile is `cloudflare-service-binding.v1`: a same-account RPC Service Binding to a non-public Workshop entrypoint, with a deployment-configured subject in authentic `ctx.props`. Workspace Authority owns the Workload Registration and all Project, Environment, Binding Set, Source, approval, and placement decisions. `cloudflare-access-service-token.v1` is a supported cross-account fallback whose bearer-secret limitations are explicit; it is not the proving slice.

Cloudflare documents that Service Bindings call non-public Worker entrypoints within the same account and that `ctx.props` is platform-delivered configuration which an authorized deployer can set and a recipient can trust without another signature. This is configuration authenticity, not immutable script/version attestation. See [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [RPC entrypoints](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/), and [`ctx.props`](https://developers.cloudflare.com/workers/runtime-apis/context/#props).

## Common adapter seam

Provider-specific code owns raw transport evidence. It exposes one narrow internal authenticator interface to the authority core; raw evidence never enters shared browser RPC types or Durable Object storage.

```ts
interface WorkloadIdentityAdapter<TransportContext> {
  readonly id: WorkloadIdentityAdapterId;
  authenticate(context: TransportContext): Promise<WorkloadIdentityEvidence>;
}

interface WorkloadIdentityEvidence {
  readonly adapterId: WorkloadIdentityAdapterId;
  readonly issuer: string;
  readonly subject: string;
  readonly assurance: "platformBinding" | "bearerToken" | "platformMediated";
  readonly authenticatedAt: number;
  readonly expiresAt: number;
  readonly auditFingerprint: string;
}
```

The transport context is adapter-owned and cannot be constructed from caller RPC arguments. The evidence contains no Workload, Project, Environment, Binding Set, Source, permission, repository, branch, deployment label, or requested binding. An optional adapter credential-lifecycle module may prepare or revoke provider credentials as durable external effects, but it cannot write authority state or events.

After authentication, the core receives a separate routing locator and looks up the Workload Registration in the named workspace. It compares adapter, issuer, subject, accepted credential generation, registration lifecycle/generation, Workload lifecycle/generation, and exact stored assignment. Only then does it mint a Workload Attachment bound to those local IDs and generations. A route or registration ID is a lookup hint, never identity; a valid provider subject cannot select another Workload or assignment.

Every adapter version defines:

- a stable adapter ID, normalized issuer and subject grammar, assurance kind, maximum evidence lifetime, and audit-safe fingerprint algorithm;
- its exact trust roots and the principals who can alter them;
- malformed, invalid, expired, unavailable, unknown-subject, generation-mismatch, and locally-revoked outcomes;
- provisioning, rotation, compromise, and provider-cleanup ownership;
- which raw values are secrets and the rule that none reach storage, events, logs, errors, or diagnostics;
- conformance cases proving caller data cannot override identity, local revocation wins, expiry fails closed, and current/overlap credential generations map only to one Registration.

The public cross-provider extension contract is this normalized output plus those conformance obligations. New providers add adapters at this seam; they do not add provider-specific identity fields to Workspace Authority or Consumer APIs.

## Workload Registration

An Authority Manager creates one Workload Registration for a stable Workload and chooses an adapter trust profile. The Workload already belongs permanently to one Project and has one current Environment and exact Binding Set assignment. Registration does not derive or alter that tuple.

The Registration stores adapter/version, issuer, current credential subject and generation, audit fingerprint, deployment trust-profile hash, lifecycle, revision, and external cleanup state. An active normalized `(adapter, issuer, subject)` maps to at most one Workload in a workspace, and one Workload has at most one active Registration in version 1.

Credential rotation is an Authority Operation, not an in-place string edit. It prepares a new random/provider-issued subject and credential generation, permits current and next credentials to resolve to the same Registration for at most 15 minutes, records proof of the new credential, then explicitly or automatically finalizes the already-approved rotation and invalidates the old generation. Expired overlap aborts or finalizes according to the recorded operation; it never leaves two indefinite credentials. Changing adapter or issuer requires a replacement Registration decision.

Local suspension or revocation increments the Registration generation and invalidates every Attachment and environment before provider cleanup. Recoverable credential failure suspends dependent Bindings; terminal Workload retirement retracts them. A provider cleanup retry cannot reactivate local authority.

## Same-account Cloudflare profile

`cloudflare-service-binding.v1` targets a named `CloudflareWorkloadEntrypoint` on the Workshop backend. The entrypoint is not routed on the public Internet. The calling Worker's Service Binding configuration contains only:

```json
{
  "binding": "CONTRACTORS_WORKSPACE",
  "service": "<workshop-backend-worker>",
  "entrypoint": "CloudflareWorkloadEntrypoint",
  "props": {
    "protocol": "cloudflare-service-binding.v1",
    "workspaceId": "<workspace-routing-id>",
    "registrationId": "<opaque-registration-id>",
    "credentialSubject": "<random-rotation-subject>",
    "credentialGeneration": 1
  }
}
```

The target's deployment supplies the expected Cloudflare account issuer; it is not accepted from `ctx.props`. Cloudflare's same-account Service Binding restriction anchors the call to that issuer. The adapter reads only `this.ctx.props`, validates an exact closed schema and protocol version, and derives evidence from the configured credential subject. The RPC `attach()` request accepts protocol negotiation and an optional correlation/idempotency value only; it rejects identity, workspace, Project, Environment, Binding Set, Source, and permission fields rather than ignoring them.

The Workload deploy principal is part of the trust root. Version 1 assumes a dedicated per-project CI principal with the narrow Worker-deploy permission necessary to configure the binding; Cloudflare account administrators remain an ultimate trust root. The runtime cannot report which deploy principal last set props, so the Registration records an approved deployment trust-profile hash but the adapter cannot enforce that human/process identity per call. A deployment where arbitrary people can edit the calling Worker does not satisfy this profile.

Anyone with effective deploy authority for the caller can configure a valid registered subject onto another Worker and impersonate that Workload. This accepted boundary is why the mechanism is called deployment-configuration identity, not script attestation. Worker version metadata is self-reported audit context only.

An Authority Manager creates the Registration and receives the non-secret binding descriptor. A deploy principal installs it. A new credential generation requires a new random subject and binding redeployment. During the bounded overlap both subjects identify the same Workload; finalization invalidates the old props immediately even if an old Worker version still runs. Removing the old binding is defense-in-depth cleanup, while local Registration state is primary revocation.

## Attachment and capability lifecycle

The Service Binding entrypoint and the cross-account WebSocket main object expose the same capability interface:

```ts
interface WorkloadConnector extends RpcTarget {
  attach(request: AttachWorkload): Promise<RpcStub<WorkloadAttachment>>;
}

interface WorkloadAttachment extends RpcTarget {
  getStatus(): Promise<WorkloadStatus>;
  openEnvironment(expectedEnvironmentGeneration: number): Promise<RpcStub<WorkloadEnvironment>>;
}

interface WorkloadEnvironment extends RpcTarget {
  getBindings(): Promise<WorkloadBindingEnvironment>;
}
```

Authentication failure returns no partial environment, candidate list, or existence oracle. Before provider authentication the public fallback surface returns only a generic denial; after valid evidence, bounded local lifecycle/readiness codes may be returned.

A Workload is stable and is not leased. A Workload Attachment is transient, capped at 15 minutes, and bound to evidence expiry plus exact Registration, Workload, environment, Binding Set, Binding, Source/grant, verification, and Contract generations. Every bridged Contract call checks those generations and the Attachment deadline. Loss or expiry of an Attachment is not a durable Workload transition and emits no Authority Event; the caller authenticates again and obtains fresh stubs.

`openEnvironment()` succeeds only when all required requirements are ready and its expected environment generation matches. It returns Contract capabilities only, never Sources or verifier capabilities. Any readiness or cited-generation change invalidates the whole immutable environment snapshot. No fallback Source or Authority Mode is selected.

Identity authentication is not mutation replay protection. `attach()` is read-like and idempotent and does not mint durable authority. Registration create/rotate/revoke operations use Authority Operation request digests and expected generations. Application Contract calls retain the Contract Runtime's action semantics and must supply method-level idempotency where retries matter; the adapter neither duplicates them nor claims that authenticated retries are safe.

## Cross-account Access fallback

`cloudflare-access-service-token.v1` uses a dedicated Access-protected workload hostname/path and one Access service token per Workload credential generation. The request includes a workspace/Registration routing hint, but identity comes only from the Access application JWT added by Cloudflare.

The edge adapter validates RS256, `kid` against the issuer's remote JWKS, exact team-domain `iss`, exact application `aud`, `iat`/`nbf`/`exp`, and the service-token shape. Its normalized subject is `common_name`, the service-token client ID. Cloudflare requires origins, including Workers, to validate the JWT rather than trusting the header alone; see [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [application-token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).

The adapter caches valid JWKS by issuer according to response freshness with a ten-minute local ceiling, refreshes once on an unknown `kid`, and fails closed when no valid cached key can verify the token. It never logs or stores the JWT, service-token headers, cookie, client secret, or request body. The public request is converted into an internal Attachment only after validation.

The deployment administrator owns the Access application, Service Auth policy, issuer/audience configuration, JWKS trust, and token API lifecycle. The Authority Manager approves the Registration and rotation. A managed deploy controller creates a fresh service token, writes its client ID and secret directly into the Workload's Worker secrets, and returns only token resource ID, client ID/fingerprint, expiry, and secret version to the lifecycle effect. For unmanaged cross-account deployment, the deploy principal receives the secret once and installs it with `wrangler secret`; Workspace Authority never retains it.

Every connection sends the client ID/secret headers through Access; version 1 does not add an Allow policy merely to reuse an application cookie. Rotation uses create-before-destroy with a new service token/client ID so the JWT subject identifies the credential generation. The old and new client IDs may overlap for at most 15 minutes, after which the old token is deleted. In-place secret rotation under one client ID is not used because the origin JWT does not prove which secret version authenticated.

This profile authenticates possession of a replayable bearer secret. Workload code can read and exfiltrate its Worker secret, and a thief is indistinguishable from the Workload until local suspension plus Access-token deletion. Compromise response therefore invalidates the Registration locally first, closes all Attachments, suspends dependent Bindings, schedules provider deletion, and issues a new credential generation only after an explicit recovery decision. Terminal Workload retirement performs Retraction. Actions accepted before detection remain attributed to that Workload.

The Access JWT bounds each Attachment to the earlier of JWT expiry and 15 minutes, but the long-lived service secret can mint another JWT until revoked. This is materially weaker than a same-account non-bearer Service Binding and must be displayed as `bearerToken` assurance.

## `CF-Worker` and version metadata

`CF-Worker` identifies an owning zone, not a script, version, or Registration, and an HTTP client can supply a lookalike header. It is never adapter evidence. A cross-account deployment may add a WAF rule using Cloudflare's trusted `cf.worker.upstream_zone` field as coarse defense in depth when a stable dedicated zone is available; mismatch can reject at the edge, but a match never completes authentication. The same-account private RPC profile gains nothing from it. See Cloudflare's [`CF-Worker` guidance](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-worker).

Worker version ID/tag/timestamp are caller-readable and unsigned from the receiver's perspective. After authentication they may appear as bounded, explicitly self-reported operational metadata, never in the normalized subject or an Authority Event.

## Verifier separation

Workload identity establishes only the Consumer. It never proves the Workload can access a provider resource and cannot satisfy `verified` Authority Mode. A verified binding requires an authority-capable Gatekeeper account that declares a `service` verifier principal, with its own Provider Account Identity, credential/capability generation, typed access check, and expiring Verification Receipt. Workload adapter subjects and Gatekeeper verifier subjects use separate namespaces and cannot substitute for each other.

## Considered options

- A caller-supplied Project, repository, Worker name, route, or version was rejected because none is receiver-verifiable authority.
- A general Cloudflare Worker attestation token was rejected because current primary documentation exposes no such mechanism for arbitrary Workers.
- Access service tokens as the first profile were rejected because the Workload can copy a reusable bearer secret and cross-account HTTP adds lifecycle complexity.
- A custom Worker-secret JWT was rejected because it would still prove possession of exportable caller-held key material while adding a private protocol.
- Worker mTLS was rejected for this path because current Worker mTLS bindings cannot call a Cloudflare-proxied service.
- Workers for Platforms Outbound Worker identity remains a future `platformMediated` adapter if Workspace Authority becomes the hosting platform; adopting that product is outside the first implementation.

## Consequences

The first Workload slice has a non-public, non-bearer capability path and an explicit deployment-principal trust statement. Local revocation and generation checks dominate provider configuration, and provider adapters remain shallow at the authority seam: they authenticate evidence but cannot choose authority.

Supporting unmanaged cross-account Workloads requires a separate Access hostname, Zero Trust lifecycle ownership, secret handoff, JWKS validation/cache recovery, and prominent bearer-compromise semantics. Future providers can plug into the normalized evidence seam only after satisfying the same conformance obligations; they do not change the Workload domain model.
