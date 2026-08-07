# Workspace Authority

Workspace Authority is the workspace-owned system that governs Sources, Contract approval, Consumers, environments, and bindings.

## Language

**Workspace Authority**:
The authority boundary that decides which approved capabilities a workspace's Consumers may possess.
_Avoid_: Manager when referring to the domain concept

**Consumer**:
An identified Gadget, development session, or deployed workload that receives capabilities from Contract Instances.
_Avoid_: App when the distinction matters

**Environment**:
A named authority configuration for a Consumer, such as development, preview, or production.
_Avoid_: Deployment when referring to the authority configuration

**Binding**:
The association through which a Consumer possesses the capability produced by a Contract Instance.
_Avoid_: Grant, permission
