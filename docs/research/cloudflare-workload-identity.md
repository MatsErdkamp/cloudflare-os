# Trusted Cloudflare Worker workload identity

_Research date: 2026-08-07. Scope: current primary Cloudflare documentation, Cloudflare API reference, and first-party platform behavior._

## Question

How can Workspace Authority authenticate a deployed Cloudflare Worker as a registered Workload without trusting a Project ID, repository name, Worker version, or other caller-supplied claim?

## Answer

Cloudflare currently exposes two practical identity shapes for ordinary Workers, plus one stronger platform-hosted option:

1. **Same Cloudflare account:** use an RPC Service Binding to a non-public Workspace Authority entrypoint and place the registered Workload ID in binding `props`. Cloudflare says Service Bindings are explicit permissions and says `ctx.props` is authentic platform-delivered configuration that does not need a secret or signature. This is the recommended first adapter when the Authority and Workload are deployed in the same Cloudflare account. It has no bearer credential to capture or replay.
2. **Different Cloudflare accounts:** use one Cloudflare Access service token per registered Workload, stored as Worker secrets, and map the verified Access application token's `common_name` (the service-token client ID) to the Workload record. This is workable but authenticates possession of a replayable shared secret, not an immutable Cloudflare Worker identity.
3. **Workers for Platforms:** if Workspace Authority becomes the hosting platform for the Workload, a platform-controlled Outbound Worker can add a short-lived Workspace-signed JWT using dispatch parameters while keeping signing credentials out of user code. This is the strongest cross-tenant design, but adopting Workers for Platforms is an architectural commitment rather than a small identity adapter.

No current primary source located in this review documents a general Cloudflare-issued OIDC or attestation token that an arbitrary deployed Worker can obtain to prove its script, version, or deployment identity to another service. `CF-Worker`, `cf.worker.upstream_zone`, and version metadata are useful context but are not a per-Worker authentication credential.

## Recommendation

Implement **`cloudflare-service-binding.v1`** first, subject to an explicit same-account deployment invariant:

- Workspace Authority exposes a named `WorkerEntrypoint` only through a Service Binding.
- The binding's deploy-time `props` contain an opaque `workloadRegistrationId` and an adapter version, not a Project ID or repository claim.
- The entrypoint reads `this.ctx.props`, looks up the active Workload registration, and derives the normalized Consumer identity exclusively from that record.
- Project, repository, Environment, version, and requested bindings are never accepted as identity evidence. They may be checked only after authentication against Authority-owned records.
- Disabling the Workload in the Authority registry denies the next call. Removing the binding in a later deployment is cleanup and defense in depth, not the primary revocation path.
- The trust statement must name the Cloudflare account/deploy authority: anyone able to configure and deploy the binding-bearing Worker is inside this adapter's trust boundary.

This recommendation follows Cloudflare's capability model: a binding is “a permission and an API in one piece,” and a Service Binding in the caller configuration is what grants permission to invoke the target. Service targets must be in the same Cloudflare account and can be kept off the public Internet. [`ctx.props` can carry caller identity and permissions; Cloudflare says only an authorized deployer can set it and that the recipient can trust it without secret keys or signatures](https://developers.cloudflare.com/workers/runtime-apis/context/#props). [Service Binding configuration and same-account constraint](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) and [the general binding capability model](https://developers.cloudflare.com/workers/runtime-apis/bindings/) support this interpretation.

If the first production milestone must authenticate customer-owned Workers deployed in **different** Cloudflare accounts, use **`cloudflare-access-service-token.v1`** first instead. That deployment-topology choice must be settled before the identity-adapter contract is finalized.

## Comparison

| Mechanism | What the Authority can authenticate | Trust root | Replay and rotation | Operational constraints | Verdict |
| --- | --- | --- | --- | --- | --- |
| Service Binding + `ctx.props` | A platform-delivered registration ID configured on a particular binding | Cloudflare Workers control plane plus principals allowed to configure/deploy the participating Workers | No portable bearer token; captured calls do not confer the binding. Registry denial is immediate application revocation; binding removal requires deployment. | Same Cloudflare account; target deployed before caller; each call counts as a subrequest/invocation. | **Recommended first adapter for same-account Workloads.** |
| Access service token + Access JWT | Possession of a unique service-token client secret; verified JWT identifies its client ID in `common_name` | Cloudflare Access account, Access policy, Access signing keys, and the Workload's secret storage | Client ID/secret and issued JWT are bearer credentials. Tokens have duration, deletion, and secret rotation; Access signing keys rotate. | Public Access-protected hostname, Zero Trust setup, per-Workload token lifecycle, JWT validation in the Worker. | **Practical cross-account fallback.** |
| Workers for Platforms Outbound Worker | Trusted dispatch tenant/workload context transformed into a platform-signed token | Workspace's Workers for Platforms dispatcher/outbound Worker and its signing key | Can use short `exp`, `aud`, and one-time `jti`; key/JWKS overlap is platform-controlled. | Requires hosting Workloads in a dispatch namespace; Outbound Workers mediate public `fetch()` and disable user `connect()`. | **Strong future option, not a small first adapter.** |
| Worker mTLS binding + Access/API Shield mTLS | Possession of a client-certificate private key, identifiable by validated certificate fields | Configured CA and certificate issuance process | TLS proves key possession per connection; rotate certificates/CA and enforce revocation. | A Worker mTLS binding currently cannot call a Cloudflare-proxied service, returning `520`; therefore it cannot reach an Access/API-Shield-protected Worker hostname. | **Not viable for Worker-to-proxied-Authority today.** |
| Custom signed JWT/JWS from a Worker secret | Possession of a private/shared key registered by Workspace Authority | Workspace key enrollment and Worker secret | Can be short-lived and nonce-bound, but key can be used by Workload code and copied by compromised code/deployer. | Must design issuer, audience, clock skew, JWKS/rotation, and replay store. Not Cloudflare attestation. | **Generic fallback, inferior to Access for the first Cloudflare adapter.** |
| `CF-Worker` / `cf.worker.upstream_zone` | The owning **zone** of a Worker subrequest | Cloudflare edge/rules evaluation | No credential to rotate; no per-script identity. | Many Workers may share a zone; the WAF field, not the HTTP header, is the trusted rule input. | **Defense in depth only.** |
| Version metadata | A Worker can read its own version ID/tag/timestamp | Caller runtime only | Not relevant; the value is self-reported over the identity boundary. | No platform signature or receiver verification is documented. | **Audit context after authentication only.** |
| Authenticated Origin Pulls | Cloudflare edge, or an account/hostname edge-to-origin path with a custom certificate | AOP certificate trusted by an origin | TLS client-auth rotation; global certificate is shared across Cloudflare accounts. | Protects Cloudflare-to-origin traffic, not the initiating Worker. | **Origin hardening, not Workload identity.** |

## Mechanism details

### 1. Service Binding with authenticated `ctx.props`

A Service Binding is configured on the calling Worker, points to a target Worker in the same account, and gives the caller permission to invoke the target through RPC or HTTP. The target can have no public route. Cloudflare documents `ctx.props` specifically as a way to convey information about the calling Worker and to create custom bindings scoped to a resource and permissions. Most importantly, Cloudflare states that the platform makes `ctx.props` authentic and that no secret/signature is needed. [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) and [`ctx.props`](https://developers.cloudflare.com/workers/runtime-apis/context/#props).

Security consequences:

- Workload code can invoke the capability but cannot manufacture a Service Binding from an ordinary HTTP request.
- No credential crosses a public network and no captured header/JWT can be replayed elsewhere.
- Authenticity is **configuration authenticity**, not immutable script attestation. A principal permitted to edit/deploy the relevant Worker is trusted and can change the binding's props.
- A Workload registration still needs an Authority-owned state check on every session/capability mint. `ctx.props` identifies the registration; it must not itself contain the authoritative Project, Environment, or permission set.
- Repeating a valid RPC method is still possible for a compromised authenticated Workload. Idempotency keys or action-specific nonces may be required for mutation semantics, but that is distinct from replay of an identity credential.

Operationally, the target must exist before the caller is deployed. Service Binding calls count toward Worker subrequest and invocation limits. [Cloudflare documents deployment ordering and limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#deployment).

### 2. Cloudflare Access service token

Cloudflare Access creates a service token as a Client ID and Client Secret. A Service Auth policy can admit a particular token, and the Worker sends the pair in `CF-Access-Client-Id` and `CF-Access-Client-Secret`. [Service-token creation and request flow](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

Access places an application JWT in `Cf-Access-Jwt-Assertion`. For service-token authentication the JWT is RS256-signed, `aud` is the Access application's audience, `iss` is the Access team domain, `exp`/`iat` bound its lifetime, `common_name` is the service token's Client ID, and `sub` is empty. The Authority must validate signature, issuer, audience, and time before mapping `common_name` to a Workload. [Application-token claims and service-token shape](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/#service-token-authentication). Cloudflare explicitly says a Worker behind Access must still validate the JWT. [JWT validation for a Cloudflare Worker](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#cloudflare-workers-example).

Replay and lifecycle properties:

- The client ID/secret pair is a reusable bearer credential. If copied, it proves the same identity until expiration, deletion, or secret rotation.
- With only Service Auth policies, Cloudflare requires the service-token headers on every request. Avoid adding an Allow policy merely to obtain a reusable application cookie; that creates another bearer token valid through its `exp`. [Request behavior and service-token policy requirement](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/#connect-your-service-to-access).
- Give each Workload its own token so `common_name` maps one-to-one and revocation/audit events remain specific.
- Cloudflare supports configured token durations, refresh/update, and deletion. Its rotate endpoint generates a new Client Secret and immediately expires the old one by default, with optional overlap via `previous_client_secret_expires_at`. [Rotate a service token API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/rotate/).
- Access account signing keys rotate by default every six weeks; the previous key remains valid for seven days. Validate against the remote key set and select by JWT `kid` rather than pinning one certificate. [Access signing-key rotation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#access-signing-keys).

Worker secrets hide their values from Wrangler and the dashboard after entry, but secret values are available to Worker code through `env`. A compromised Workload can therefore use or exfiltrate an Access secret; this adapter proves registered credential possession, not execution by a particular untampered Worker version. [Workers secrets behavior](https://developers.cloudflare.com/workers/configuration/secrets/).

### 3. Workers for Platforms Outbound Worker

Workers for Platforms can place an Outbound Worker between user Workers and the public Internet. Trusted parameters passed by the dynamic dispatcher are available to the Outbound Worker, and Cloudflare's own example adds a per-customer JWT to calls to a platform API without giving credentials to customer code. [Outbound Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/).

That enables a stronger adapter if Workspace Authority hosts production Workloads:

- the dispatch layer supplies the registered Workload ID;
- the Outbound Worker mints a very short-lived token with `iss`, Authority-specific `aud`, `iat`, `exp`, and unique `jti`;
- the Authority verifies the platform's key and active Workload registration, and may consume `jti` once when strict replay prevention is required;
- signing material never enters customer Worker code.

This token is still a Workspace-defined token, not a native Cloudflare workload-attestation token. The product must also accept the hosting limitations: outbound mediation applies to public `fetch()`, does not intercept Durable Object or mTLS-binding fetches, and prevents user Workers from using TCP `connect()`. These constraints are documented on the same [Outbound Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/) page.

### 4. mTLS

Cloudflare Access and API Shield can verify client certificates, including a specific Common Name or CA, and expose verified certificate properties. API Shield recommends checking the issuer SKI and supplies fields for certificate revocation; uploaded third-party CA revocation lists are not automatically checked. [Access mTLS](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/) and [API Shield mTLS configuration](https://developers.cloudflare.com/api-shield/security/mtls/configure/).

Workers can use an mTLS certificate binding whose `fetch()` presents an uploaded client certificate without exposing a raw private key through the binding API. However, Cloudflare currently says this binding cannot make requests to a service in a Cloudflare-proxied zone; those requests receive `520`. [Workers mTLS binding limitation](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/). Since a Workspace Authority Worker or Access-protected Worker is reached on a Cloudflare-proxied hostname, the two features cannot currently form a Worker-to-Authority authentication path. mTLS remains viable only if the verifier terminates TLS on a direct/unproxied origin.

### 5. Signals that must not become primary identity

- Cloudflare adds `CF-Worker` to Worker subrequests, but it contains the owning zone, not a script, version, or registration. For WAF rules Cloudflare directs users to `cf.worker.upstream_zone` instead of matching the header. A zone may contain multiple Workers, so this is at most coarse allowlisting/defense in depth. [Cloudflare `CF-Worker` header](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-worker) and [`cf.worker.upstream_zone`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.worker.upstream_zone/).
- A version metadata binding gives Worker code its version ID, version tag, and creation timestamp. Those values are not accompanied by receiver-verifiable proof; sending them over HTTP is a self-assertion. Use them only as audit metadata after another adapter authenticates the Workload. [Version metadata binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/).
- Authenticated Origin Pulls proves the Cloudflare edge to an origin. The global certificate is shared across accounts; custom zone/hostname certificates can prove a narrower Cloudflare-to-origin path, but none identifies the initiating Worker. [AOP purpose and levels](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/).
- A custom JWT signed with a key from a Worker secret is technically possible because Workers supports Web Crypto signing, but it is a generic enrolled-key protocol and not Cloudflare platform identity. The key is available to Workload code. [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) and [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Required properties for the adapter contract

The follow-on identity-adapter design should preserve these findings:

1. **Evidence is provider-specific; identity is Authority-owned.** The adapter verifies Service Binding props, an Access JWT, or a platform JWT, then returns only a normalized Workload registration identity. It never accepts Project/repository metadata as authority.
2. **Registration status is checked after cryptographic/platform authentication.** Provider validity does not imply the Workload is active, assigned to the claimed Environment, or allowed to resolve a Binding Requirement.
3. **Trust roots are explicit.** Store adapter kind, provider account/team/application identifiers, registered credential identifier, provisioning actor, and lifecycle state. For Service Bindings, record that Cloudflare deployment principals are trusted.
4. **Revocation is local-first.** A disabled Workload is rejected immediately even if a binding, Access token, certificate, or JWT remains technically valid. Provider deletion/rotation follows as cleanup.
5. **Identity and freshness are separate.** Service Binding calls do not replay a bearer credential, but mutations may still need idempotency. Access tokens are bearer credentials and should not be described as proof-of-possession. Platform JWTs need short expiry and optional `jti` consumption.
6. **Audit evidence is bounded.** Record adapter kind, provider credential ID or binding registration ID, verification time, outcome, and provider key/version metadata. Never record secrets, JWTs, client certificates, headers, or request bodies.

## Newly surfaced decisions and fog

### Decision needed before the first adapter is locked

**Must the first production Workload run in the same Cloudflare account as Workspace Authority?**

- **Yes:** choose `cloudflare-service-binding.v1`. It is native, capability-based, non-public, and non-bearer.
- **No:** choose `cloudflare-access-service-token.v1` for the first cross-account slice, accepting bearer-secret semantics, or deliberately adopt Workers for Platforms to retain platform-mediated short-lived identity.

### Follow-on decisions

- Which Cloudflare principals may configure/deploy a binding-bearing Workload, and is account-wide Worker deploy authority acceptable as the Service Binding adapter's impersonation boundary?
- Does disabling a Workload need to terminate already-minted long-lived capability sessions, or is denial on the next Authority call sufficient? This belongs with the Contract graph-wide Retraction decision.
- For Access, who owns the Zero Trust account/application and automates per-Workload token creation, secret delivery, overlap rotation, deletion, and expiration alerts?
- Is a copied Access secret inside a compromised-but-deployed Worker within the accepted threat model, or does production require platform-controlled signing via Workers for Platforms?
- Are mutations merely idempotent, or must the identity protocol guarantee one-time request processing with nonce/`jti` storage?
- Should `CF-Worker`/`cf.worker.upstream_zone` be added as defense-in-depth when available, knowing it authenticates only a zone and cannot identify the Workload?

## Source index

- [Cloudflare Workers: Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Cloudflare Workers: `ctx.props`](https://developers.cloudflare.com/workers/runtime-apis/context/#props)
- [Cloudflare Workers: binding capability model](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [Cloudflare Access: service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- [Cloudflare Access: application-token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Cloudflare Access: validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare API: rotate a service token](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/rotate/)
- [Cloudflare Workers: secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare for Platforms: Outbound Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/)
- [Cloudflare Workers: mTLS binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/)
- [Cloudflare Access: mTLS](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)
- [Cloudflare API Shield: configure mTLS](https://developers.cloudflare.com/api-shield/security/mtls/configure/)
- [Cloudflare: `CF-Worker` request header](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-worker)
- [Cloudflare Ruleset Engine: `cf.worker.upstream_zone`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/cf.worker.upstream_zone/)
- [Cloudflare Workers: version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)
- [Cloudflare: Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)
- [Cloudflare Workers: Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
