# Domain docs

This repository uses a multi-context domain model.

## Before exploring

Read `CONTEXT-MAP.md`, then read the context glossaries relevant to the work.
Also inspect applicable system-wide and context-specific ADRs.

Missing files are created lazily by the domain-modeling workflow when the first
term or durable architectural decision is resolved.

## Layout

- `CONTEXT-MAP.md` indexes the repository's bounded contexts.
- Each indexed context owns a `CONTEXT.md`.
- `docs/adr/` contains system-wide architectural decisions.
- Context-specific `docs/adr/` directories contain local decisions.

Use canonical terms from the relevant glossary in issues, specifications, APIs,
tests, and implementation plans. Surface conflicts with existing ADRs instead
of silently overriding them.
