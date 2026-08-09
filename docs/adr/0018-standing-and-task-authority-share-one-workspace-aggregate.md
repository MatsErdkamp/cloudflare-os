---
status: accepted
---

# Standing and task authority share one Workspace aggregate

## Context

The standing Workspace Authority model must grow to govern bounded Agent Tasks without turning Project, Chat, Agent Service, Contractors, Gatekeepers, User Durable Objects, or review infrastructure into another authority aggregate. The extension also needs one placement vocabulary without claiming that the enforcement topology, revocation sequence, or task lifetime has already been proven.

## Decision

Workspace is the sole transactional authority aggregate and organizational boundary. Project is a cross-repository software scope inside a Workspace; Repository Claims are untrusted provenance and discovery metadata. Workspace Authority owns durable standing decisions and records. Agent Task Authority is the authority of one bounded execution materialized inside the same Workspace aggregate, and its Trust Ratchet may only preserve or reduce effective authority beneath an approved Task Template ceiling.

| Module               | Owns                                                                                                                                        | Must not own                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Workspace Authority  | Canonical standing and Agent Task records, decisions, generations, events, effects, and reconciliation inside the Workspace aggregate       | Provider credentials, Contract execution, or a parallel task aggregate |
| Agent Task Authority | One bounded execution's materialized ceiling, Task Environment, task Bindings, and monotonic Trust Ratchet state within Workspace Authority | Reusable standing authority or a separate durable authority store      |
| Contractors          | Generic Contract Artifact execution, capability-graph lifecycle, and neutral lifecycle evidence                                             | Workspace, Task Template, dispatch, placement, or Trust Ratchet policy |
| Gatekeepers          | Credentials, provider authority, provider identity/generation, and task-neutral provider evidence                                           | Consumer selection, task policy, ambience, or Workspace decisions      |
| User Durable Object  | Personal Accounts and explicit personal consent                                                                                             | Workspace policy, task policy, or shared placement                     |
| Review builder       | Bounded immutable evidence from content-addressed inputs                                                                                    | Approval, placement, Sources, Bindings, or task capabilities           |

Contractors remains the generic executable capability kernel shared by standing and task authority. It executes immutable Contract Artifacts over typed Upstream Authority and emits task-neutral lifecycle evidence. Gatekeepers report provider-native scope and revocation granularity. Review builders receive only content-addressed inputs.

Binding Resolution remains the one canonical immutable placement model. Its requirement reference is exactly either an Environment Binding Requirement version or a Task Binding Requirement in one immutable Task Template version. Its placement-decision reference is exactly either an Installation Decision or a Task Dispatch Decision. Every Resolution records the exact Consumer, requirement reference, Upstream Authority and relevant generations, Artifact Approval epoch, placement decision, Contract Instance, applicable shared-state choice, and expected Binding generation. Contract Instance and Binding remain separate records.

Artifact Approval accepts one exact executable Contract Artifact and review evidence. Task Template Approval accepts one exact immutable Task Template version and pins the Artifact Approval epochs in its maximum ceiling. A Runtime Approval Request and Runtime Approval Decision release authority already present for one operation. Organization Policy Gates are distinct release conditions. Contract possession preapproves only the provider actions exposed by the installed Contract; no runtime or organization gate may create, broaden, extend, or restore authority.

Agent Service is a role/profile keyed one-to-one to a registered Workload. It has no separate standing Consumer identity, Account, Source, Binding Set, or provider authority. Chat stores history, provenance, and task references, never reusable live authority.

Authority Debt is the reviewed difference between provider-native authority and the narrower effective standing or task authority. It always retains provider-native scope, effective scope, enforcement layer (`provider`, `gatekeeper`, `contract`, or `business-rule-only`), revocation granularity, risk, exception owner, production eligibility, and remediation. Task narrowing never erases broader provider-native debt.

## Reserved decisions

This decision does not select a Binding enforcement topology, define the externally visible revocation point or crash-safe abort/commit order, or define Agent Task lifetime and continuation. Those mechanisms remain unresolved until the prototypes and lifecycle decisions in #22–#25 are synthesized by #39.

## Consequences

- Overseer remains the aggregate host and may delegate to one deep authority module; no parallel Manager or Task Durable Object becomes authoritative.
- Standing and task placement use one Resolution model with explicit discriminated references rather than parallel resolvers.
- Provider observations stay task-neutral; Workspace/task enforcement adds Consumer, task, environment, invocation, generation, and Trust Ratchet correlation.
- A runtime unsupported by the eventual enforcement design cannot host an Agent Task.
