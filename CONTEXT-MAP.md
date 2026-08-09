# Context Map

## Contexts

- [Contract Runtime](./packages/contractors/CONTEXT.md) — turns approved Contract artifacts and Sources into retractable capabilities without owning standing or task policy
- [Contract Review Evidence](./packages/contract-review-builder/CONTEXT.md) — reproduces Contract candidates in isolated runners and publishes immutable review evidence without approval or placement authority
- [Workspace Authority](./packages/workshop-backend/CONTEXT.md) — owns the workspace aggregate, including standing authority and each bounded Agent Task Authority execution

## Relationships

- **Workspace Authority → Contract Runtime**: Workspace Authority supplies an approved Contract Artifact, exact Upstream Authority, and generation-bound execution inputs for a standing or task Consumer; Contract Runtime creates the corresponding Contract Instance.
- **Contract Runtime → Workspace Authority**: Contract Runtime exposes retractable capabilities and neutral lifecycle evidence; Workspace Authority owns their standing or Agent Task placement and lifecycle decisions.
- **Contract Review Evidence → Workspace Authority**: the builder publishes content-addressed Bundles and Comparisons; Workspace Authority independently records the Proposal and Approval decisions that cite them.
- **Contract Runtime → Contract Review Evidence**: the builder invokes the current compiler in two isolated runners and compares exact Artifact, dependency, toolchain, and trace outputs without gaining runtime authority.
