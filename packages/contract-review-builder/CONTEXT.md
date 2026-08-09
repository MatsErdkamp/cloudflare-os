# Contract Review Evidence

**Contract Review Evidence Builder**:
An authority-neutral build context that runs the same registered Contract recipe in two distinct fresh, network-disabled trusted runners and publishes a Review Bundle only when the exact Artifact, dependency closure, toolchain, recipe, and consumed-file trace agree.

**Review Build Runner**:
One disposable isolated execution environment that receives only closed Contract build inputs. It returns a candidate, exact dependency lock, toolchain identity, recipe, and isolation evidence; it never receives Workspace, Provider Source, Account, Binding, approval, or decision capabilities.

**Contract Review Bundle**:
The sole current content-addressed manifest over exact authoring inputs, emitted Artifact authority, declarations, dependency closure, toolchain, trace, policy snapshot, provenance, and two agreeing Build Attestations. It is evidence for review, never executable or placement authority.

**Review Comparison**:
The sole current content-addressed comparison between one Review Bundle and its declared baseline. Its generator identity and exact old/new hashes are evidence cited by an Artifact Approval, not runtime policy.

**Build Attestation**:
A bounded statement from one trusted runner identifying its fresh network-disabled environment and the exact input, Artifact, dependency, toolchain, recipe, declaration, and trace hashes it reproduced.

**Relationship to Contract Runtime**:
The builder consumes the current Contractors compiler and emits evidence around a candidate. Contractors remains the executable capability kernel and does not approve the result.

**Relationship to Workspace Authority**:
The builder publishes immutable evidence only. Workspace Authority independently records Artifact Proposals and Artifact Approvals that cite exact evidence hashes; the builder never receives or makes those decisions.
