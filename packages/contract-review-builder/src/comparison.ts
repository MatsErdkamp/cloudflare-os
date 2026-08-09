import {hashReviewValue, ReviewEvidenceError} from "./canonical.js";
import type {
  ContractReviewBundle,
  ReviewBaseline,
  ReviewComparison,
  ReviewComparisonSection,
} from "./types.js";

const SECTION_NAMES = [
  "originalModules",
  "emittedExecutable",
  "artifactAuthority",
  "publicInterface",
  "sourceDeclaration",
  "dependencies",
  "toolchainAndRecipe",
  "originAndAuthorship",
  "reproducibility",
] as const;

function sectionValue(bundle: ContractReviewBundle, name: typeof SECTION_NAMES[number]): unknown {
  switch (name) {
    case "originalModules": return bundle.originalModules;
    case "emittedExecutable": return bundle.artifact.emittedModules;
    case "artifactAuthority": return {hash: bundle.artifact.hash, blob: bundle.artifact.authority};
    case "publicInterface": return bundle.artifact.publicDeclaration;
    case "sourceDeclaration": return bundle.source;
    case "dependencies": return bundle.build.dependencyLock;
    case "toolchainAndRecipe": return {
      toolchain: bundle.build.toolchain,
      recipe: bundle.build.recipe,
      trace: bundle.build.trace,
      policySnapshot: bundle.build.policySnapshot,
    };
    case "originAndAuthorship": return bundle.provenance;
    case "reproducibility": return bundle.attestations;
  }
}

/** Generates a deterministic exact-hash comparison without making an approval claim. */
export async function createReviewComparison(
  baseline: ReviewBaseline,
  baselineBundle: ContractReviewBundle | undefined,
  candidateBundle: ContractReviewBundle,
  candidateBundleHash: string,
  generator: Readonly<{readonly name: string; readonly identity: string}>,
): Promise<ReviewComparison> {
  if (baseline.kind === "bundle") {
    if (!baselineBundle || await hashReviewValue(baselineBundle) !== baseline.bundleHash) {
      throw new ReviewEvidenceError("INVALID_INPUT", "Comparison baseline bundle is missing or mismatched.");
    }
  } else if (baselineBundle !== undefined) {
    throw new ReviewEvidenceError("INVALID_INPUT", "A full-addition comparison cannot include a baseline bundle.");
  }
  const sections: ReviewComparisonSection[] = [];
  for (const name of SECTION_NAMES) {
    const newHash = await hashReviewValue(sectionValue(candidateBundle, name));
    if (!baselineBundle) {
      sections.push({name, change: "added", newHash});
      continue;
    }
    const oldHash = await hashReviewValue(sectionValue(baselineBundle, name));
    sections.push({
      name,
      change: oldHash === newHash ? "unchanged" : "modified",
      oldHash,
      newHash,
    });
  }
  return {baseline, candidateBundleHash, generator, sections};
}
