import { describe, expect, it } from "vitest";

import {
  CONTRACT_HARNESS,
  CONTRACT_RUNTIME_HARNESS_VERSION,
  contractHarnessForVersion,
} from "../src/index";

describe("Contract Dynamic Worker harness", () => {
  it("receives private authority through startSession and exposes only managed context", () => {
    expect(CONTRACT_HARNESS).toContain("async startSession(session)");
    expect(CONTRACT_HARNESS).toContain("source: wrapCapability(session.source.dup())");
    expect(CONTRACT_HARNESS).toContain("class LifecycleCapability extends RpcTarget");
    expect(CONTRACT_HARNESS).toContain("policy: createPolicy(session.policy.approval.dup())");
    expect(CONTRACT_HARNESS).toContain("operation({source: wrapCapability(source.dup())})");
    expect(CONTRACT_HARNESS).toContain("target[Symbol.dispose]()");
    expect(CONTRACT_HARNESS).toContain("storage: this.ctx.storage");
    expect(CONTRACT_HARNESS).toContain("const restorer = session.restorer.dup()");
    expect(CONTRACT_HARNESS).toContain("restorer.restore(restorationId)");
    expect(CONTRACT_HARNESS).toContain("async restoreSession(session, restorationId)");
    expect(CONTRACT_HARNESS).not.toContain("this.env");
    expect(CONTRACT_HARNESS).not.toContain("fetch(");
  });

  it("validates the root and delegates persistent restoration to approved code", () => {
    expect(CONTRACT_HARNESS).toContain("binding instanceof RpcTarget");
    expect(CONTRACT_HARNESS).toContain("contractModule.restoreContractCapability");
    expect(CONTRACT_HARNESS).toContain("[restore](params)");
    expect(CONTRACT_RUNTIME_HARNESS_VERSION).toBe("7");
    expect(CONTRACT_HARNESS).toContain("value instanceof Map");
    expect(CONTRACT_HARNESS).toContain("value instanceof Set");
    expect(contractHarnessForVersion("7")).toBe(CONTRACT_HARNESS);
    expect(contractHarnessForVersion("6")).not.toBe(CONTRACT_HARNESS);
    expect(contractHarnessForVersion("5")).not.toBe(CONTRACT_HARNESS);
    expect(contractHarnessForVersion("4")).not.toBe(CONTRACT_HARNESS);
    expect(contractHarnessForVersion("3")).not.toBe(CONTRACT_HARNESS);
    expect(contractHarnessForVersion("2")).not.toBe(CONTRACT_HARNESS);
    expect(contractHarnessForVersion("1")).not.toBe(CONTRACT_HARNESS);
    expect(() => contractHarnessForVersion("retired")).toThrow("Unsupported");
  });
});
