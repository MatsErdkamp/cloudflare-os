# Context Map

## Contexts

- [Contract Runtime](./packages/contractors/CONTEXT.md) — turns approved Contract artifacts and Sources into retractable capabilities
- [Workspace Authority](./packages/workshop-backend/CONTEXT.md) — governs which Consumers receive approved capabilities in each workspace environment

## Relationships

- **Workspace Authority → Contract Runtime**: Workspace Authority selects an approved Contract artifact and Source for a Consumer; Contract Runtime creates the corresponding Contract Instance.
- **Contract Runtime → Workspace Authority**: Contract Runtime exposes retractable capabilities whose lifecycle is governed by Workspace Authority.
