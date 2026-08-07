# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create issues with `gh issue create`.
- Read issues and their comments with `gh issue view`.
- Apply and remove labels with `gh issue edit`.
- Close issues with `gh issue close`.
- Infer the repository from the configured Git remote.
- Pull requests are not a triage request surface.

## Wayfinding operations

- A map is an issue labelled `wayfinder:map`.
- Decision tickets are child issues labelled `wayfinder:research`,
  `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Use GitHub sub-issues where available. Otherwise, place children in a task
  list on the map and add `Part of #<map>` to each child.
- Use native issue dependencies for blocking relationships where available.
  Otherwise, add a `Blocked by: #<issue>` line to the child.
- Claim a ticket by assigning it to the driving developer before beginning.
- The frontier consists of open, unassigned child issues with no open blockers.
- Resolve a ticket by posting its answer, closing it, and appending a short
  linked context pointer to the map's "Decisions so far" section.
