import { describe, expect, it } from "vitest";

import { AdminApiImpl } from "../src/admin-settings.js";

describe("AdminApi Contract dependency governance", () => {
  it("persists a validated deployment policy", async () => {
    let updates: unknown[] = [];
    let admin = {
      updateAdminConfig: async (patch: unknown) => { updates.push(patch); },
    };
    let api = new AdminApiImpl(admin as never, "admin@example.com");

    await api.setContractorsDependencyPolicy({
      allowedPackages: ["zod", "@scope/tools"],
      deniedPackages: ["left-pad"],
      allowedVersions: {zod: "4.2.0"},
      maxBundleBytes: 250_000,
    });

    expect(updates).toEqual([{contractors: {
      allowedPackages: ["zod", "@scope/tools"],
      deniedPackages: ["left-pad"],
      allowedVersions: {zod: "4.2.0"},
      maxBundleBytes: 250_000,
    }}]);
  });

  it.each([
    {allowedPackages: [""]},
    {allowedPackages: ["zod", "zod"]},
    {allowedVersions: {zod: "latest"}},
    {allowedPackages: ["zod"], deniedPackages: ["zod"]},
    {deniedPackages: ["zod"], allowedVersions: {zod: "4.2.0"}},
    {maxBundleBytes: -1},
    {maxBundleBytes: 1.5},
  ])("rejects malformed policy %#", async (policy) => {
    let admin = {updateAdminConfig: async () => undefined};
    let api = new AdminApiImpl(admin as never, "admin@example.com");

    await expect(api.setContractorsDependencyPolicy(policy)).rejects.toThrow();
  });
});
