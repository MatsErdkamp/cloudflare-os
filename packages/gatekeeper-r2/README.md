# R2 Storage gatekeeper

This auto-provisioned gatekeeper gives each connected account a private, streaming object-storage
Source backed by one deployment-owned Cloudflare R2 bucket. It deliberately does not expose an
ambient singleton: an owner must bind `r2://storage/root` to a workspace before an agent or Gadget
can use it.

## Capability model

Every account receives a random opaque account ID. Logical keys are stored below
`accounts/<accountId>/objects/`, while pending upload bodies live below an invisible staging
namespace. Neither physical prefix is returned through the Source API.

Reads call `authorizeObservation()` before returning data. Writes and deletes are staged and sent
to the Workshop approval queue; `applyAction()` is the only path that mutates the visible object
namespace. A rejected write removes its staging object, and a rejected delete leaves the original
object untouched. Collaborator observers are refused because the root is private to one account.

The Source API in [`src/types.d.ts`](./src/types.d.ts) provides `head`, `get`, `put`, `list`, and
`delete`. Bodies are streamed instead of buffered.

## Prefix-scoped Contract example

[`examples/folder-contract.ts`](./examples/folder-contract.ts) converts the broad private Source
into a Contract capability fixed beneath `shared/`. Its consumer sees only relative paths and can
derive still-narrower live capabilities with `subfolder()`. It rejects absolute, encoded, dot,
parent, empty-segment, backslash, and lookalike-separator paths. The Contract never returns or
accepts the raw Source stub.

Change `ROOT_PREFIX` before compiling the example if a different folder should be shared. A
separate Contract binding should be created for each independently granted prefix.

## Deployment

The release manifest provisions the `STORAGE` R2 binding and treats this gatekeeper as having no
OAuth credential inputs. For a direct deployment, create the configured `gadgets-r2-storage`
bucket (or change `bucket_name` in `wrangler.jsonc`), then run `pnpm deploy` in this package.

Run `pnpm test` for the Worker integration tests and `pnpm types:check` for the package type check.
The Contract example is compiled by the `@gadgets/contractors` test suite.
