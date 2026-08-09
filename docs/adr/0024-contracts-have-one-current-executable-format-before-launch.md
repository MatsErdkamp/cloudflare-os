# Contracts have one current executable format before launch

Status: Accepted

## Context

The Contract subsystem is still pre-launch. Retaining harness generations, Artifact formats, legacy
authoring exports, and compatibility loaders was adding several authoritative representations before
there was deployed customer data to preserve. It also made the runtime identity claim harder to
audit: a numeric selector could name code whose bytes had changed independently.

## Decision

Contractors exposes one current authoring interface, one closed Artifact representation, one runtime
profile, and one Contract harness. No Contract format, ABI, schema, or harness version selector is
part of the public or persisted model. Exact authoring declaration, harness, runtime module-set, and
runtime-profile hashes remain in Artifact identity because they describe executable bytes rather
than compatibility generations.

The compiler returns the current candidate through `@gadgets/contractors/compiler`. Runtime-safe
Artifact parsing and identity verification live in `@gadgets/contractors/artifact`. The Workshop
retains the exact closed Artifact JSON in a proposal and validates it again at acceptance; it never
reconstructs authority from a partial RPC mirror.

Artifacts, Contract records, and pending proposals from the removed formats are unsupported. They
fail closed and must be retired or reset before enabling this pre-launch build. Their hashes are
never reinterpreted under the current harness, and unreachable R2 objects may be deleted by an
explicit deployment reset. There is no in-place compatibility migration.

## Consequences

- Changing any executable authoring or runtime byte changes its content hash and requires rebuilding
  and reviewing a new current Artifact.
- Creation time, review, approval, installation, and placement metadata remain outside Artifact
  identity.
- External identities such as dependency package versions and Workers compatibility dates/flags
  remain exact build inputs; this decision removes only internal Contract format generations.
- A future compatibility promise requires a new decision backed by deployed-data requirements, not
  speculative version scaffolding.

## Superseded decisions

This decision supersedes ADR 0005's historical-harness consequence, ADR 0009's numeric harness
version build option, ADR 0010's persisted runtime-harness version, and ADR 0017's requirement to
preserve and execute historical Contract formats. ADR 0017's single canonical Workspace Authority
cutover and forward-only repair rules remain controlling.
