---
status: accepted
---

# Agent Task runtimes use one generation-gated mediator protocol

Agent Tasks can execute only through a Workspace-owned Task Enforcement Mediator that checks one
closed Task Invocation Envelope and correlates its outcome before any protected data reaches the
model or Chat. Version 1 enables only the Code Mode/Dynamic Worker, host-tool, and canonical R2
Contract paths needed by the R2 proof; every other runtime path is disabled for Agent Tasks until a
conforming adapter implements the same protocol. This trades breadth for a reviewable fail-closed
boundary and prevents a runtime-specific side door from outliving a Task Environment generation.

## Closed mediator protocol

The Workspace creates a fresh capability-free Task Invocation Envelope for each attempted call. It
contains exactly:

- Task Authority Correlation, including the bounded actor chain;
- Task Dispatch Decision, Task Template Approval, Agent Service Workload/Registration, Agent Task,
  lease, Task Environment, Trust Ratchet, Binding, Binding Resolution, Contract Instance, Artifact
  Approval, Upstream Authority, and provider-capability identities and generations;
- one normalized Effective Authority Envelope and its digest;
- one invocation ID, closed operation class, normalized resource selector, declared result class,
  recipient class, and explicit egress destination set;
- `issuedAt`, `leaseExpiresAt`, immutable `absoluteExpiresAt`, and an invocation deadline no later
  than either authority deadline;
- one cancellation ID and generation; the Workspace-owned cancellation capability is delivered
  separately as a non-serializable companion and is never part of the envelope; and
- the expected mediator profile and acknowledgement generation.

The envelope contains no Source capability, credential, token, raw provider session, ambient binding,
prompt, prior result, or reusable bearer secret. It is valid for one invocation only. The mediator
re-resolves the current canonical records before forwarding and again before releasing a result. A
missing field, unknown enum member, stale generation, unsupported operation/result shape, widened
resource or egress set, elapsed deadline, or cancelled generation fails closed.

The mediator returns a closed acknowledgement containing the invocation ID, exact Task Environment,
Ratchet, and acknowledgement generations, mediator profile, operation class, outcome (`completed`, `cancelled`,
`deadlineExceeded`, `denied`, or `failed`), bounded timestamps, optional task-neutral Source Activity
reference, optional Protected Observation reference, and an Agent Activity ID. It never returns raw
protected bytes in the acknowledgement.

## Invocation and release ordering

1. Workspace Authority validates the current dispatch tuple and issues the one-shot envelope plus a
   cancellation capability.
2. The runtime adapter checks that its profile is enabled for the Task Template and that every path
   reachable from the invocation is mediated or disabled.
3. The adapter propagates the earliest deadline and cancellation generation into the Contract,
   Source session, host tool, and any supported asynchronous cursor.
4. Provider output is written to the protected-result store under the exact invocation, Binding,
   lease, Task Environment, and Ratchet generations. It is not inserted into model context, Chat,
   callbacks, logs, or an unprotected cache.
5. The adapter records bounded Agent Activity and returns its acknowledgement to Workspace Authority.
6. Workspace Authority revalidates the complete tuple and current release rule. Only an acknowledged
   release gate may transform the protected reference into the bounded value delivered to the model.
7. Cancellation, pause, replacement, terminal Task state, or any generation mismatch permanently
   blocks release by the predecessor generation and roots cleanup where required.

Transport loss is not authority. Retrying an exact operation may recover its durable acknowledgement,
but it cannot replay provider work or release a result under a new generation unless the adapter's
idempotency record proves the exact prior outcome and Workspace Authority adopts it explicitly.

## Enforcement coverage

| Path | V1 Agent Task status | Required behavior |
| --- | --- | --- |
| Code Mode / Dynamic Workers | Mediated for the R2 MVP | Receive only the exact Task Environment generation and named task Bindings; no standing or ambient bindings are injected. Worker loading uses the approved artifact/runtime profile. |
| Dynamic Worker network | Disabled except mediated bindings | `globalOutbound: null`; direct `fetch`, sockets, DNS, and other network escape paths are unavailable. |
| Host tool `executeCode` | Mediated for the R2 MVP | Launches only the approved, network-disabled Dynamic Worker profile with the exact Task Environment. Its completion is correlated Agent Activity; protected Binding results remain references until release. |
| Host tool `describeBinding` | Mediated metadata-only | Returns only the approved public type declaration for one named current Task Binding after the same generation check. It cannot invoke the Binding or return provider data. |
| Host tool `giveUp` | Mediated control-only | Requests terminal Task failure under the current task generation and carries no provider authority or protected result. |
| Every other Workshop host tool | Disabled | `readFile`, `writeFile`, `editFile`, `webFetch`, `observeUserChanges`, `setGadgetBinding`, `createGadget`, `listBlueprints`, `listConnectableResources`, `proposeContract`, and `requestConnection` are absent from the Agent Task tool catalog. No unlisted host tool is admitted. |
| Canonical R2 Contract / Source observations | Mediated for the R2 MVP | Calls traverse the task Binding Enforcement Endpoint and task-neutral Gatekeeper authority protocol; observation bytes remain protected until release acknowledgement. Writes remain exact Contract operations under the same envelope. |
| Web fetch | Disabled | No general outbound fetch is exposed to an Agent Task in v1. A future adapter must normalize destinations and mediate request and response bodies. |
| MCP, including remote MCP | Unsupported and unavailable | No MCP capability or endpoint is placed in a Task Environment. A future adapter must classify tool annotations independently and mediate transport, result protection, and cancellation. |
| Browser / computer use | Unsupported and unavailable | No browser session, page capability, screenshot stream, or computer-control capability is reachable from an Agent Task. |
| Sandbox / arbitrary code execution | Unsupported and unavailable | No general sandbox capability is reachable beyond the bounded Dynamic Worker profile above. |
| Containers | Unsupported and unavailable | No container lifecycle, filesystem, process, or network capability is reachable. |
| Subprocesses | Unsupported and unavailable | Process creation and stdio streams are absent from the supported runtime profile. |
| Raw TCP / sockets | Unsupported and unavailable | No socket capability is exposed; Dynamic Worker outbound networking remains null. |
| Callbacks | Unsupported for task authority | A callback from current synchronous work is task-neutral evidence until the Workspace validates its exact invocation generations. Persistent callbacks request a fresh Task and never retain this Task Environment. |
| Webhooks | Unsupported for task authority | Incoming webhooks may match an independently approved standing registration and request a fresh Task; payloads never carry or resume task authority. |

“Disabled” and “unsupported” both mean the path is absent at runtime, not merely undocumented. The
future adapter ticket may move a row to `mediated` only after conformance covers every authority,
egress, cancellation, asynchronous-result, restoration, and protected-release shape the path exposes.

## Evidence and conformance

Agent Activity is a closed Workspace-owned record with:

- an Authority-issued Activity ID and one of `invocationIssued`, `runtimeStarted`, `sourceAttempted`,
  `sourceCompleted`, `resultProtected`, `releaseAcknowledged`, `cancelled`, `deadlineExceeded`,
  `denied`, or `failed`;
- the complete Task Authority Correlation plus Task Dispatch Decision, Agent Task generation, lease
  generation, Task Environment generation, Ratchet version, Binding ID/generation, Contract Instance
  ID/generation, mediator profile, invocation ID, and cancellation generation;
- the closed operation and result classes, bounded `startedAt`/`completedAt` timestamps and outcome;
  and
- optional task-neutral Source Activity ID, Protected Observation ID, release-acknowledgement ID,
  and predecessor Activity ID references.

The schema has no extension map or arbitrary metadata. Agent Activity never contains credentials,
prompts, headers, request/response bodies, protected content, or authority decisions.
Source Activity remains task-neutral and is referenced by ID. Authority Events record durable task
state and release decisions; operational logs remain diagnostic only.

The R2 MVP must prove:

- no ambient or standing Binding appears in a Task Environment;
- stale lease, Task Environment, Ratchet, Binding, cancellation, and deadline generations reject
  before invocation and again before release;
- direct Dynamic Worker network access and every unsupported matrix path are unavailable;
- cancellation reaches in-flight Contract, Source, host-tool, and supported cursor work;
- protected R2 observations cannot enter model context before an exact release acknowledgement;
- restart and outcome-unknown recovery cannot duplicate provider work or revive predecessor results;
  and
- terminal Task cleanup leaves only bounded tombstone/evidence references.

Issue #40 implements only the Code Mode/Dynamic Worker, `executeCode`, `describeBinding`, `giveUp`,
and canonical R2 Contract/Source paths. Browser, container, remote-MCP,
subprocess, raw-TCP, callback, webhook, and other adapters remain the explicit scope of #44.
