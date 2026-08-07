# Contract Runtime

The Contract Runtime turns approved code and a Source into a retractable capability without exposing the Source to the Consumer.

## Language

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

**Installation Decision**:
A workspace decision placing an approved Contract Artifact over one exact Source for one exact Consumer Binding.
_Avoid_: Artifact Approval, generic permission

**Contract Instance**:
A live placement of one Contract Artifact over one Source for one Consumer; possession of its capabilities is standing approval until the instance is retracted.
_Avoid_: Grant, permission record

**Source**:
The authority-bearing resource capability supplied to a Contract Instance and never exposed raw to its Consumer.
_Avoid_: Credential, secret

**Retraction**:
Termination of a Contract Instance and the entire capability graph derived from it.
_Avoid_: Unbinding when referring to the security property

**Approval Gate**:
A runtime decision point explicitly authored by Contract code for one operation, separate from Artifact Approval and Installation Decision.
_Avoid_: Platform policy rule
