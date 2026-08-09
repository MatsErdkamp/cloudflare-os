# Context Map

## Contexts

- [Contract Runtime](./packages/contractors/CONTEXT.md) — turns approved Contract artifacts and Sources into retractable capabilities without owning standing or task policy
- [Workspace Authority](./packages/workshop-backend/CONTEXT.md) — owns the workspace aggregate, including standing authority and each bounded Agent Task Authority execution

## Relationships

- **Workspace Authority → Contract Runtime**: Workspace Authority supplies an approved Contract Artifact, exact Upstream Authority, and generation-bound execution inputs for a standing or task Consumer; Contract Runtime creates the corresponding Contract Instance.
- **Contract Runtime → Workspace Authority**: Contract Runtime exposes retractable capabilities and neutral lifecycle evidence; Workspace Authority owns their standing or Agent Task placement and lifecycle decisions.
