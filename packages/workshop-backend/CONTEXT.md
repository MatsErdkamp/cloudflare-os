# Workspace Authority

Workspace Authority is the workspace-owned system that governs Sources, Contract approval, Consumers, environments, and bindings.

## Language

**Workspace Authority**:
The authority boundary that decides which approved capabilities a workspace's Consumers may possess.
_Avoid_: Manager when referring to the domain concept

**Workspace Account**:
A workspace-owned connection whose credential and provider lifecycle is governed by Workspace Authority.
_Avoid_: Shared Source, service account when the provider does not use that term

**Source Record**:
Workspace Authority's provenance and lifecycle record for a selectable Source derived from a personal or Workspace Account.
_Avoid_: Credential record

**Project**:
The authority-side aggregate that groups repository claims, named Environments, development sessions, and deployed workloads for one body of software.
_Avoid_: Repository when referring to the aggregate

**Consumer**:
An identified Gadget, development session, or deployed workload that receives capabilities from Contract Instances.
_Avoid_: App when the distinction matters

**Development Session**:
A short-lived, leased Consumer representing an authenticated local development connection.
_Avoid_: Local daemon, developer machine

**Workload**:
A deployed Consumer whose identity is established by a trusted provider-specific identity adapter.
_Avoid_: Project ID, deployment claim

**Environment**:
A named authority configuration for a Consumer, such as development, preview, or production.
_Avoid_: Deployment when referring to the authority configuration

**Binding Requirement**:
A Project Environment's declaration of a capability it needs and the authority-resolution policy that constrains how Workspace Authority may satisfy it.
_Avoid_: Grant, environment variable

**Binding**:
The association through which a Consumer possesses the capability produced by a Contract Instance.
_Avoid_: Grant, permission

**Authority Event**:
An append-only audit fact recording a decision or lifecycle transition within Workspace Authority.
_Avoid_: Log line

**Graduation**:
Creation of Project-owned Contract Instances equivalent to a Gadget's approved bindings, with lineage back to the Gadget and without changing the Gadget's live security identity.
_Avoid_: Export, moving an instance
