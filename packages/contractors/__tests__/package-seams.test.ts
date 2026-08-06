import {describe, expect, it, vi} from "vitest";

import {
  ContractSourceApprovalQueue,
  contractActionAttribution,
  contractRestorationStorageKey,
  type ContractOperationHost,
} from "../src/index";
import {
  TestContractHost,
  assertContractCapabilitiesRetracted,
} from "../src/testing/index";

const CALL = {
  callId: "call-1",
  contractId: 7,
  artifactHash: "sha256:artifact",
  sourceGatekeeperId: 17,
  caller: {from: "gadget"},
  startedAt: new Date(0),
  methodName: "publish",
};

describe("Contract package host seams", () => {
  it("derives attribution and stable restoration keys", () => {
    expect(contractActionAttribution(CALL, "operation-1")).toEqual({
      contractId: 7,
      artifactHash: "sha256:artifact",
      contractCallId: "call-1",
      contractMethod: "publish",
      contractOperationId: "operation-1",
    });
    expect(contractRestorationStorageKey("child-1"))
      .toBe("contract:restoration:child-1");
    expect(() => contractRestorationStorageKey("")).toThrow("must not be empty");
  });

  it("adapts Source observations and actions without adding a generic approval gate", async () => {
    const authorizeObservation = vi.fn(async () => {});
    const submitAction = vi.fn(async () => {});
    const queue = new ContractSourceApprovalQueue(
      {authorizeObservation, submitAction},
      CALL,
      {type: "manual", operationId: "operation-1"},
    );

    await queue.authorizeObservation({title: "Read"});
    await queue.submitAction(3, {title: "Write"});

    expect(authorizeObservation).toHaveBeenCalledWith(CALL, {title: "Read"});
    expect(submitAction).toHaveBeenCalledWith(
      CALL,
      {type: "manual", operationId: "operation-1"},
      3,
      {title: "Write"},
    );
  });

  it("provides isolated shared-state namespaces in the reusable test host", async () => {
    const operations = {} as ContractOperationHost<unknown>;
    const host = new TestContractHost(operations);
    await host.sharedState("left").put("value", {count: 1});

    await expect(host.sharedState("left").get("value")).resolves.toEqual({count: 1});
    await expect(host.sharedState("right").get("value")).resolves.toBeUndefined();
  });

  it("reports any capability call that survives retraction", async () => {
    await expect(assertContractCapabilitiesRetracted([
      () => { throw new Error("retracted"); },
      () => Promise.reject(new Error("retracted")),
    ])).resolves.toBeUndefined();
    await expect(assertContractCapabilitiesRetracted([
      () => Promise.reject(new Error("retracted")),
      () => "still live",
    ])).rejects.toThrow("indexes: 1");
  });
});
