import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { compileContract } from "../src/compiler/index.js";

const CONTRACT_PATH = fileURLToPath(
  new URL("../../gatekeeper-r2/examples/folder-contract.ts", import.meta.url),
);
const SOURCE_TYPES_PATH = fileURLToPath(
  new URL("../../gatekeeper-r2/src/types.ts", import.meta.url),
);

describe("R2 folder Contract example", () => {
  it("compiles to a prefix-scoped public capability without leaking the raw Source", async () => {
    const [contract, sourceTypes] = await Promise.all([
      readFile(CONTRACT_PATH, "utf8"),
      readFile(SOURCE_TYPES_PATH, "utf8"),
    ]);

    const candidate = await compileContract({
      modules: { "contract.ts": contract },
      mainModule: "contract.ts",
      sourceTypes,
      sourceRootType: "R2BucketSession",
      dependencies: {},
      compatibilityDate: "2026-08-06",
    });

    expect(candidate.artifact.publicTypes).toContain("interface ContractBinding");
    expect(candidate.artifact.publicTypes).toContain("subfolder(path: string)");
    expect(candidate.artifact.publicTypes).toContain("body: Uint8Array");
    expect(candidate.artifact.publicTypes).not.toContain("ReadableStream");
    expect(candidate.artifact.publicTypes).not.toContain("R2BucketSession");
    expect(candidate.artifact.modules["contract.js"]).toContain('ROOT_PREFIX = "shared/"');
  });
});
