import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  CONTRACT_HARNESS,
  CONTRACT_HARNESS_V8,
  CONTRACT_RUNTIME_HARNESS_VERSION,
  CONTRACT_RUNTIME_HARNESS_V8_VERSION,
  contractHarnessForVersion,
} from "../src/runtime/index";

describe("Contract Dynamic Worker harness", () => {
  it("keeps every historical v1-v7 harness byte-stable", () => {
    const fixtures = {
      "1": [1074, "03a81cc7489ae0bacff2f1d996f23773178abf070bcafbf3d6c3655e88e9bd7d"],
      "2": [1114, "5daa318d133f941693a02bed98a9a9e8f769c0b306d78132b2854cc61374506c"],
      "3": [2026, "06d3f1085f1c31f926fe199ed591900c936db8f8b4185baf00dbda1e3b72b388"],
      "4": [3103, "63401bebf59564e97687eecf5542e8adff0478c8acc4c0f49f8ae144e49ca5da"],
      "5": [3140, "681dc52d5597cbbab27eb408a29c6523fbe828e2b4208abfce2318c358ae2bee"],
      "6": [4141, "7e1d8a32e6d246579a69e9f4bf580cd0800874250198fc659f47772af608edb9"],
      "7": [4580, "201ffee324f860d47fb7750689faacb2ee85685048bcb2c05b2a84d777ec6a10"],
    } as const;

    for (const [version, [bytes, sha256]] of Object.entries(fixtures)) {
      const harness = contractHarnessForVersion(version);
      expect(Buffer.byteLength(harness, "utf8"), version).toBe(bytes);
      expect(createHash("sha256").update(harness).digest("hex"), version).toBe(sha256);
    }
  });

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

  it("adds direct approval and invocation evidence only in v8", () => {
    expect(CONTRACT_RUNTIME_HARNESS_V8_VERSION).toBe("8");
    expect(CONTRACT_HARNESS_V8).toContain("approval: createApproval(session.approval.dup())");
    expect(CONTRACT_HARNESS_V8).toContain("invocation: closedInvocationEvidence(session.invocation)");
    expect(CONTRACT_HARNESS_V8).not.toContain("policy: createPolicy");
    expect(CONTRACT_HARNESS_V8).not.toContain("caller: session.caller");
    expect(contractHarnessForVersion("8")).toBe(CONTRACT_HARNESS_V8);
  });
});
