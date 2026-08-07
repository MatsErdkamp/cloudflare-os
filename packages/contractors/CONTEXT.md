# Contract Runtime

The Contract Runtime turns approved code and a Source into a retractable capability without exposing the Source to the Consumer.

## Language

**Contract Artifact**:
An immutable, content-addressed program whose public interface defines the capabilities it may expose from one Source.
_Avoid_: Policy object, grant

**Contract Instance**:
A live placement of one Contract Artifact over one Source for one Consumer; possession of its capabilities is standing approval until the instance is retracted.
_Avoid_: Grant, permission record

**Source**:
The authority-bearing resource capability supplied to a Contract Instance and never exposed raw to its Consumer.
_Avoid_: Credential, secret

**Retraction**:
Termination of a Contract Instance and the entire capability graph derived from it.
_Avoid_: Unbinding when referring to the security property
