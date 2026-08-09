import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CONTRACT_MAX_COMPOSITION_DEPTH,
  createContractRestorationRecord,
  validateContractReachabilitySnapshot,
  type ContractReachabilitySnapshot,
} from "../src/runtime/capability-lifecycle.js";

function snapshot(
  overrides: Partial<ContractReachabilitySnapshot> = {},
): ContractReachabilitySnapshot {
  return {
    endpointId: "endpoint-a",
    instanceId: "instance-a",
    instanceGeneration: 3,
    artifactHash: "sha256:artifact",
    runtimeProfileHash: "sha256:profile",
    reachabilityId: "reachability-a",
    reachabilityGeneration: 4,
    authoritySnapshotDigest: "sha256:authority",
    compositionLineage: ["endpoint-a"],
    chainDepth: 0,
    maxChainDepth: 4,
    ...overrides,
  };
}

describe("Contract lifecycle host values", () => {
  it("validates, copies, and freezes a closed task-neutral reachability snapshot", () => {
    const lineage = ["endpoint-a"];
    const input = snapshot({ compositionLineage: lineage });
    const validated = validateContractReachabilitySnapshot(input);
    lineage.push("changed");

    expect(validated.compositionLineage).toEqual(["endpoint-a"]);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.compositionLineage)).toBe(true);
    expect(() => validateContractReachabilitySnapshot({
      ...input,
      taskId: "forbidden-domain-field",
    } as never)).toThrow("not closed");
    expect(() => validateContractReachabilitySnapshot(snapshot({
      maxChainDepth: CONTRACT_MAX_COMPOSITION_DEPTH + 1,
    }))).toThrow("runtime profile");
  });

  it("seals restoration to exact identity with bounded capability-free params", () => {
    const params = { folder: ["one", "two"] };
    const record = createContractRestorationRecord(snapshot(), "restore-1", params);
    params.folder.push("changed");

    expect(record.params).toEqual({ folder: ["one", "two"] });
    expect(Object.isFrozen(record)).toBe(true);
    let getterRead = false;
    const accessor = Object.defineProperty({}, "authority", {
      enumerable: true,
      get() { getterRead = true; return () => undefined; },
    });
    expect(() => createContractRestorationRecord(snapshot(), "restore-accessor", accessor))
      .toThrow("accessors");
    expect(getterRead).toBe(false);
    expect(() => createContractRestorationRecord(snapshot(), "restore-capability", {
      callback: () => undefined,
    })).toThrow("contain authority");
  });

  it("keeps host lifecycle values task-neutral and outside control-plane vocabulary", () => {
    const source = readFileSync(path.resolve(
      process.cwd(),
      "src/runtime/capability-lifecycle.ts",
    ), "utf8");
    expect(source).not.toMatch(/TaskTemplate|TaskDispatch|TrustRatchet|InstallationDecision/);
  });
});
