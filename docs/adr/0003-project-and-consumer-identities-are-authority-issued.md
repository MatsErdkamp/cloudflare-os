# Project and Consumer identities are authority-issued

Projects, Environments, Development Sessions, and Workloads use stable or leased opaque identities issued inside Workspace Authority; none is derived from a repository URL, path, branch, configuration value, or deployment label. A Project can relate to multiple repositories, and one monorepo can relate to multiple Projects through attributed Repository Claims. Those claims remain review metadata even after an Authority Manager accepts them.

## Considered options

- Treating a repository as the Project was rejected because monorepos, multi-repository software, and multiple deployed workloads do not share that cardinality.
- Trusting a checked-in project or environment identifier was rejected because anyone able to edit the repository could redirect credential-backed authority.
- Creating a new Workload identity for every deployment revision was rejected because ordinary deployments should preserve approved bindings and audit continuity; the trusted provider subject identifies a registered logical Workload, while revision evidence is recorded separately.

## Consequences

- A Gadget remains its existing workspace-scoped Consumer and is never relabeled as a Project during Graduation.
- Development Session identities are terminal when their lease expires; reconnecting after expiry creates a new identity.
- A Workload belongs to exactly one Project and resolves exactly one Environment at a time. Multiple Workloads may target the same Environment.
- An authenticated provider subject maps to at most one active Workload within a workspace, avoiding ambiguous authority resolution.
- Project and Environment names are mutable labels. Identity equality and bindings use their opaque IDs, and retired IDs are never reused.
- Repository configuration can propose project, environment, workload, ref, and path claims, but Workspace Authority establishes every relationship that can convey authority.
