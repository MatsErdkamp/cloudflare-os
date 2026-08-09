# Review bundles are reproducible content-addressed evidence

The Contract Artifact hash remains the normative executable authority. A Contract Review Bundle is a separately hashed canonical manifest over immutable evidence blobs, finalized only after a clean trusted rebuild reproduces the exact Artifact authority fields. Artifact Approval binds the Artifact and Review Bundle and cites the exact Review Comparison presented; source provenance and generated diffs improve the decision without becoming runtime policy.

## Canonical bundle format

The sole current Contract Review Bundle is canonical UTF-8 JSON encoded with the existing `canonicalContractJson` rules: object keys sort lexicographically, absent optional fields are omitted, arrays use schema-defined order, numbers are safe integers, timestamps are canonical UTC RFC 3339, and metadata strings are NFC. It carries no numeric format selector. Authoring and generated text are stored as exact UTF-8 blobs and are never Unicode-, newline-, or whitespace-normalized. Module paths are NFC POSIX-relative paths with no empty, dot, parent, absolute, backslash, control-character, or post-normalization duplicate segments.

Every blob reference is `{ hash: "sha256:<lowercase-hex>", bytes, mediaType }`. The Review Bundle hash is SHA-256 of the canonical manifest bytes and is not stored inside the hashed manifest. Volatile transport metadata and R2 ETags never participate.

The current manifest contains:

- authenticated `submittedBy` identity/generation, bounded authorship attribution, and origin (`workspaceChat`, `gadget`, `repositoryClaim` plus commit/path, or `import` plus digest); repository claims remain untrusted provenance, and prompts are never retained;
- exact main-module path and every original authoring module blob;
- exact Source declaration blob, Source root type, and Source type hash, but no provider Account, resource, credential, or installation identity;
- a registered build recipe identity and all normalized options, including compatibility date,
  flags, target, platform, module format, externals, public root, and the exact authoring, harness,
  runtime module-set, and runtime-profile hashes;
- trusted compiler-environment digest and locked component identities for `@gadgets/contractors`, TypeScript, esbuild/native binary, Workers declarations, runtime, and relevant platform image or package closure;
- direct dependency requests, a sorted resolved transitive lock graph with registry integrity and package-content hashes, and a deterministic build trace naming the exact package files consumed;
- the deployment dependency-policy snapshot/digest evaluated during the build;
- the exact canonical Artifact authority JSON blob, emitted module blobs, Artifact hash, public declaration blob/root, and their hashes;
- two Build Attestations and a reproducibility verdict;
- the declared comparison baseline: a prior Review Bundle/Artifact Approval, or explicit `none` for a full-addition review.

Created time, proposal ID, reviewer, decision, and installation fields live in Workspace Authority records and Authority Events, not in the build manifest unless they are genuine submitted provenance. Identical blobs deduplicate globally even when different origin or attestation metadata correctly gives two manifests different hashes.

## Trusted build and reproducibility

The candidate compiler and verifier run the same registered recipe in separate fresh, network-disabled trusted sandboxes. Inputs come only from manifest blobs and the content-addressed dependency/toolchain store. Each Build Attestation records input-set digest, recipe/toolchain digests, Artifact hash, generated public-type hash, Source-type hash, dependency-lock digest, build-trace digest, and bounded producer identity; timestamps and diagnostic logs are not build inputs.

The builder is an authority-neutral offline or isolated build service, not code running inside the Workspace aggregate. It may publish only immutable blobs, the reproduced Bundle, the Comparison, and their content identities. The Workshop proposal path accepts those identities rather than executable JSON in chat, reloads and validates the immutable records, and then records a distinct Artifact Proposal. Acceptance reloads the same evidence again before it records an Artifact Approval; installation is a subsequent authority operation. A chat message may retain bounded presentation snapshots, but they are never an Artifact or evidence store.

The verifier reconstructs the candidate from the original modules rather than trusting submitted emitted code. `reproducible` requires exact equality of every Artifact authority field after canonical encoding, not merely equivalent JavaScript or the same public interface. It also requires identical dependency lock and build trace. The second build's non-authority creation time is ignored.

Malformed manifests, missing/hash-mismatched blobs, undeclared inputs, network attempts, policy failures, and non-reproducible output never enter the authoritative Review Bundle prefix and cannot create an approvable Artifact Proposal. Workspace Authority may retain a requester-visible failed-attempt record containing at most 100 bounded diagnostic codes/locations and 64 KiB for seven days; it is not review evidence or an Authority Event. Staged objects expire after 24 hours.

## Review Comparison

The sole current Review Comparison is a separate canonical, content-addressed manifest generated deterministically from the exact baseline and candidate bundle hashes. It carries no numeric format selector. For a first approval, the baseline is empty and every item is an addition. Its sections cover:

- original modules: add/delete/modify plus exact text patches; rename detection is marked heuristic;
- emitted executable modules and Artifact authority fields;
- public Contract interface and Source declarations, with both exact text and AST-derived exported-surface changes;
- direct and transitive dependency, integrity, package-content, and build-trace changes;
- compiler, toolchain, recipe, compatibility date, runtime harness, and governance-policy changes;
- reproducibility attestations and origin/authorship changes.

Every section retains old/new blob or field hashes, so truncating a rendered patch never hides that exact content changed. Semantic classifications and risk summaries are informational, explicitly pinned to a content-addressed generator identity, and cannot replace full source, emitted code, or declarations. A generator change produces a new comparison hash even for the same bundles.

Artifact Approval records the exact Artifact hash, Review Bundle hash, Review Comparison hash, baseline approval/bundle, and generator identity hash. The comparison proves what review aid was shown; only the Artifact hash is runtime authority, and the bundle remains the underlying provenance evidence.

## Limits and redaction

Hard protocol caps apply before hashing; deployment policy may lower them:

- 256 KiB canonical bundle manifest and 256 KiB comparison manifest;
- 128 authoring modules, 256 UTF-8 bytes per path, 2 MiB per text blob, and 8 MiB total authoring source;
- 2 MiB each for Source declarations and public declarations;
- 8 MiB emitted executable modules in addition to any lower deployment bundle limit;
- 512 dependency-lock entries, 4,096 build-trace entries, and 32 MiB total unique blobs referenced by one bundle;
- 4 MiB total rendered comparison patches, with deterministic per-file truncation and exact hashes retained;
- 128 UTF-8 bytes for bounded origin/toolchain metadata strings.

Required build inputs and outputs are never redacted after hashing. If source contains a credential, token, prompt, personal data, or other forbidden content, the proposal is rejected and the source must be changed and rebuilt. Optional origin metadata is omitted rather than replaced with a misleading redaction marker. Review access is restricted to the owner and live `manageAuthority` capabilities; Consumers never receive bundle blobs.

## R2 storage and integrity

Immutable objects use these keys:

- `contracts/review/blobs/sha256:<hex>` for exact blobs;
- `contracts/review/bundles/sha256:<hex>.json` for manifests;
- `contracts/review/comparisons/sha256:<hex>.json` for comparison manifests;
- the existing `contracts/artifacts/sha256:<hex>.json` for executable Artifacts;
- `contracts/review/staging/<authority-operation-id>/...` only for incomplete uploads.

Writers upload and verify blobs first, then atomically publish the manifest with create-if-absent semantics. A collision winner is accepted only after canonical bytes and every referenced hash/length match. Readers validate key syntax, schema, canonical re-encoding, manifest hash, all blob hashes and lengths, Artifact hash, internal cross-references, limits, and reproducibility before returning evidence. Missing or conflicting content is corruption and fails approval/installation closed; R2 ETags are concurrency aids, not integrity.

Workspace records hold explicit reference IDs for proposals, approvals, retained Authority Events, Contract instances/tombstones, and comparisons. A deployment-level idempotent reference ledger makes those roots visible to garbage collection without becoming an authority source of truth. Because Authority Events retain evidence hashes for the workspace lifetime, their bundles and comparisons remain reachable until workspace deletion. Unreferenced staged data expires after 24 hours; unreachable published manifests/blobs have a 30-day safety window before mark-and-sweep deletion. Implementations may initially retain published content indefinitely, but must not delete without proving zero live roots and zero manifest edges.

## Considered options

- Adding original source and compiler metadata to the Contract Artifact hash was rejected because it would replace the existing executable authority identity and make identical runtime authority differ by provenance.
- A ZIP or tar archive was rejected because archive ordering, metadata, and compression create a second source of nondeterminism and prevent blob-level deduplication.
- Trusting a client/compiler attestation without a clean server-side rebuild was rejected because it cannot prove submitted emitted code came from the reviewed source.
- Approving semantic summaries instead of exact source and output was rejected because summaries are incomplete, generator-dependent interpretations.
- A redacted source bundle was rejected because it cannot reproduce or substantiate the executable under review.

## Consequences

- `compileContract` evolves to return a candidate plus exact build inputs; only the trusted verifier finalizes a Review Bundle.
- The pre-launch historical Artifact and evidence formats are unsupported rather than reinterpreted; only the sole current content-addressed records may enter a new proposal or approval.
- The review UI can present high-signal diffs while always linking back to exact immutable evidence.
- Persistence and migration must distinguish verified new bundles from legacy approvals whose original source/build provenance is unknown.
