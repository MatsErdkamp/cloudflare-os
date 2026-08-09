import { describe, expect, it } from "vitest";

import {
  ContractApprovalRejected,
  ContractApprovalRequired,
  createContractPolicy,
  type ContractOperationDecision,
} from "../src/runtime/index";
import type { ContractOperationHost } from "../src/host/index";

type Source = {
  write(value: string): Promise<string>;
  read(): Promise<string>;
};

class FakeOperationHost implements ContractOperationHost<Source> {
  readonly events: string[] = [];
  decision: ContractOperationDecision | undefined;
  provisional: string | undefined;
  private nextId = 1;

  async beginManual() {
    const operationId = `manual-${this.nextId++}`;
    this.events.push(`begin:${operationId}`);
    return {
      operationId,
      source: {
        write: async (value: string) => {
          this.events.push(`stage:${value}`);
          this.provisional = value;
          return `provisional:${value}`;
        },
        read: async () => {
          this.events.push("read");
          return this.provisional ?? "original";
        },
      },
    };
  }

  async finishManual(operationId: string) {
    this.events.push(`finish:${operationId}`);
  }

  async abortManual(operationId: string) {
    this.events.push(`abort:${operationId}`);
  }

  async findRequirement() {
    return this.decision;
  }

  async createRequirement() {
    const operationId = `require-${this.nextId++}`;
    this.events.push(`require:${operationId}`);
    this.decision = { operationId, state: "pending" };
    return operationId;
  }
}

function policy(host: FakeOperationHost) {
  return createContractPolicy({
    source: {
      write: async (value) => `applied:${value}`,
      read: async () => "original",
    },
    contract: { id: "contract-7", artifactHash: "sha256:artifact" },
    caller: { from: "gadget", gadgetId: 9 },
    operationHost: host,
  });
}

describe("Contract approval policy", () => {
  it("executes manual callbacks immediately against a staged Source and finalizes one operation", async () => {
    const host = new FakeOperationHost();

    const result = await policy(host).approval.manual(
      { title: "Publish", description: "Publish release" },
      ({ source }) => source.write("release"),
    );

    expect(result).toBe("provisional:release");
    expect(host.events).toEqual(["begin:manual-1", "stage:release", "finish:manual-1"]);
  });

  it("makes staged simulation visible to later calls in the same manual callback", async () => {
    const host = new FakeOperationHost();

    const result = await policy(host).approval.manual(
      {title: "Publish", description: "Publish release"},
      async ({source}) => {
        await source.write("release");
        return source.read();
      },
    );

    expect(result).toBe("release");
    expect(host.events).toEqual([
      "begin:manual-1", "stage:release", "read", "finish:manual-1",
    ]);
  });

  it("discards staged children when a manual callback fails", async () => {
    const host = new FakeOperationHost();

    await expect(policy(host).approval.manual(
      { title: "Publish", description: "Publish release" },
      async () => { throw new Error("failed"); },
    )).rejects.toThrow("failed");

    expect(host.events).toEqual(["begin:manual-1", "abort:manual-1"]);
  });

  it("creates a retryable requirement and honors its later decision", async () => {
    const host = new FakeOperationHost();
    const approval = policy(host).approval;
    const requirement = { key: "read:secret", title: "Read", description: "Read secret" };

    await expect(approval.require(requirement)).rejects.toEqual(
      new ContractApprovalRequired("require-1"),
    );

    host.decision = { operationId: "require-1", state: "approved" };
    await expect(approval.require(requirement)).resolves.toBeUndefined();

    host.decision = { operationId: "require-1", state: "rejected" };
    await expect(approval.require(requirement)).rejects.toEqual(
      new ContractApprovalRejected("require-1"),
    );
  });

  it("blocks reads, writes, capability returns, and callback registration before continuation", async () => {
    for (const continuation of ["read", "write", "capability", "callback"] as const) {
      const host = new FakeOperationHost();
      const events: string[] = [];
      const run = async () => {
        await policy(host).approval.require({
          key: `gate:${continuation}`,
          title: "Continue",
          description: `Allow ${continuation}`,
        });
        events.push(continuation);
        if (continuation === "read") await policy(host).approval.manual(
          {title: "Read", description: "Read"}, ({source}) => source.read());
        if (continuation === "write") await policy(host).approval.manual(
          {title: "Write", description: "Write"}, ({source}) => source.write("value"));
        if (continuation === "capability") return {read: () => "authority"};
        if (continuation === "callback") return (value: string) => value;
      };

      await expect(run()).rejects.toBeInstanceOf(ContractApprovalRequired);
      expect(events).toEqual([]);
      expect(host.events).toEqual(["require:require-1"]);
    }
  });
});
