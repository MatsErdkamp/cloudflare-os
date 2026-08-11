/** Hard protocol caps applied before review evidence is hashed. */
export const REVIEW_LIMITS = Object.freeze({
  manifestBytes: 256 * 1024,
  comparisonBytes: 256 * 1024,
  renderedComparisonPatchBytes: 4 * 1024 * 1024,
  moduleCount: 128,
  pathBytes: 256,
  textBlobBytes: 2 * 1024 * 1024,
  totalAuthoringBytes: 8 * 1024 * 1024,
  declarationBytes: 2 * 1024 * 1024,
  emittedBytes: 8 * 1024 * 1024,
  dependencyEntries: 512,
  buildTraceEntries: 4_096,
  totalUniqueBlobBytes: 32 * 1024 * 1024,
  metadataBytes: 128,
} as const);
