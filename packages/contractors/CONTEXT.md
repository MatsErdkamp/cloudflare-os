# Contract Runtime

The Contract Runtime turns approved code and a Source into a retractable capability without exposing the Source to the Consumer.

## Language

**Contractors**:
The generic executable capability kernel that implements the Contract Runtime for both standing and Agent Task Authority without owning either policy model.
_Avoid_: Workspace Authority, task authority store

**Contract Artifact**:
An immutable, content-addressed executable whose public interface defines the capabilities it may expose from one Source. Its hash is the normative runtime authority identity.
_Avoid_: Policy object, grant

**Contract Review Bundle**:
An immutable, content-addressed manifest linking a Contract Artifact to exact authoring inputs, Source declarations, dependency closure, trusted build recipe/toolchain, origin, and independent reproducibility evidence.
_Avoid_: Artifact, semantic summary

**Build Attestation**:
A bounded record from one trusted isolated build identifying its exact inputs, recipe, toolchain, and resulting Contract Artifact. Two matching attestations establish reproducibility but do not grant approval.
_Avoid_: Artifact Approval, CI log

**Review Comparison**:
A content-addressed, versioned presentation of exact and derived differences between a Contract Review Bundle and its declared baseline. It is mandatory review evidence but never executable authority.
_Avoid_: Permission summary, approval

**Artifact Approval**:
A workspace decision accepting one exact Contract Artifact and Review Bundle for potential installation, while citing the exact Review Comparison shown, without granting it to any Consumer.
_Avoid_: Installation, deployment

**Task Template Approval**:
A Workspace decision accepting one exact immutable Task Template Version and its pinned Artifact Approval epochs as a maximum task ceiling, without authorizing every Principal to dispatch it.
_Avoid_: Artifact Approval, Task Dispatch Decision, runtime approval

**Installation Decision**:
A workspace decision placing an approved Contract Artifact over one exact Source for one exact Consumer Binding.
_Avoid_: Artifact Approval, generic permission

**Contract Instance**:
A live placement of one Contract Artifact over one Source for one Consumer. Possession preapproves the provider actions exposed by that installed Contract until its capability graph is retracted.
_Avoid_: Grant, permission record

**Source**:
The authority-bearing resource capability supplied to a Contract Instance and never exposed raw to its Consumer.
_Avoid_: Credential, secret

**Upstream Authority**:
The exact generation-bound Source or Binding capability supplied to a Contract Instance for attenuation and execution.
_Avoid_: Credential, ambient provider access, inferred dependency

**Retraction**:
Termination of a Contract Instance and the entire capability graph derived from it.
_Avoid_: Unbinding when referring to the security property

**Runtime Approval Request**:
A Contract-authored request to release already-present authority for one runtime operation; it cannot create, broaden, extend, or restore authority.
_Avoid_: Artifact Approval, Task Template Approval, authority proposal

**Runtime Approval Decision**:
The bounded decision on one Runtime Approval Request, distinct from Artifact Approval, Task Template Approval, placement, and organization policy.
_Avoid_: Installation Decision, Task Dispatch Decision, policy grant

**Organization Policy Gate**:
An organization-owned release condition over authority already present in a Contract or Binding; it cannot create, broaden, extend, or restore that authority.
_Avoid_: Runtime Approval Decision, authority grant
