import { describe, expect, it, vi } from "vitest";
import { RpcTarget } from "cloudflare:workers";

import { defineContract } from "../../contractors/src/authoring/define-contract.js";
import type { ContractContext } from "../../contractors/src/authoring/contract-context.js";

class SecretCapability extends RpcTarget {
  reveal(): string { return "source authority"; }
}

class CursorCapability extends RpcTarget {
  next(): string { return "next page"; }
}

class CustomCapability extends RpcTarget {
  constructor(private readonly value: string) { super(); }
  read(): string { return this.value; }
}

class FakeEmailSource extends RpcTarget {
  readonly secret = new SecretCapability();
  readonly cursor = new CursorCapability();
  readonly calls: string[] = [];
  hookCallback?: (email: {id: string; subject: string; private: boolean}) => void;

  listEmails() {
    return [
      {id: "public", subject: "Launch", body: "full private body", private: false},
      {id: "private", subject: "Payroll", body: "salary", private: true},
    ];
  }

  async archive(id: string) { this.calls.push(`archive:${id}`); }
  async notify(id: string) { this.calls.push(`notify:${id}`); }
  getCapability() { return this.secret; }
  getCursor() { return this.cursor; }
  bindEmailHook(callback: (email: {id: string; subject: string; private: boolean}) => void) {
    this.hookCallback = callback;
  }
  emit(email: {id: string; subject: string; private: boolean}) {
    this.hookCallback?.(email);
  }
}

interface PublicEmailContract extends RpcTarget {
  visible(): Promise<Array<{id: string; subject: string}>>;
  publish(id: string): Promise<void>;
  custom(): CustomCapability;
  delegated(): SecretCapability;
  nested(): {capability: SecretCapability};
  pages(): CursorCapability;
  functionValue(): (value: string) => string;
  withCallback(callback: (subject: string) => void): Promise<void>;
  forwardVisible(callback: (email: {id: string; subject: string}) => void): void;
}

const createEmailContract = defineContract<FakeEmailSource, PublicEmailContract>((contractContext) =>
  new class extends RpcTarget implements PublicEmailContract {
    async visible() {
      return contractContext.source.listEmails()
        .filter(email => !email.private)
        .map(({id, subject}) => ({id, subject}));
    }

    async publish(id: string) {
      await contractContext.source.archive(id);
      await contractContext.source.notify(id);
    }

    custom() { return new CustomCapability("custom"); }
    delegated() { return contractContext.source.getCapability(); }
    nested() { return {capability: contractContext.source.getCapability()}; }
    pages() { return contractContext.source.getCursor(); }
    functionValue() { return (value: string) => `renamed:${value}`; }
    async withCallback(callback: (subject: string) => void) {
      callback(contractContext.source.listEmails()[0]!.subject);
    }

    forwardVisible(callback: (email: {id: string; subject: string}) => void) {
      contractContext.source.bindEmailHook(email => {
        if (!email.private) callback({id: email.id, subject: email.subject});
      });
    }
  }());

function context(source: FakeEmailSource): ContractContext<FakeEmailSource> {
  return {
    source,
    policy: {
      approval: {
        async manual(_description, operation) { return operation({source}); },
        async require() {},
      },
    },
    storage: {} as DurableObjectStorage,
    caller: {from: "gadget", gadgetId: 7},
    contract: {id: "11", artifactHash: "sha256:test"},
    restore() { throw new Error("not used"); },
  };
}

describe("Contract generative attenuation", () => {
  it("can hide, redact, rename, and compose several Source operations", async () => {
    let source = new FakeEmailSource();
    let contract = await createEmailContract(context(source));

    await expect(contract.visible()).resolves.toEqual([{id: "public", subject: "Launch"}]);
    await contract.publish("public");
    expect(source.calls).toEqual(["archive:public", "notify:public"]);
  });

  it("preserves arbitrary direct, nested, cursor, custom, and function capabilities", async () => {
    let source = new FakeEmailSource();
    let contract = await createEmailContract(context(source));

    expect(contract.custom().read()).toBe("custom");
    expect(contract.delegated()).toBe(source.secret);
    expect(contract.nested().capability).toBe(source.secret);
    expect(contract.pages()).toBe(source.cursor);
    expect(contract.functionValue()("value")).toBe("renamed:value");
  });

  it("accepts callbacks without imposing a JSON transport", async () => {
    let callback = vi.fn();
    let contract = await createEmailContract(context(new FakeEmailSource()));
    await contract.withCallback(callback);
    expect(callback).toHaveBeenCalledWith("Launch");
  });

  it("installs a Source hook on a Contract callback and forwards only filtered events", async () => {
    const source = new FakeEmailSource();
    const consumer = vi.fn();
    const contract = await createEmailContract(context(source));

    contract.forwardVisible(consumer);
    expect(source.hookCallback).toBeTypeOf("function");
    source.emit({id: "private", subject: "Payroll", private: true});
    source.emit({id: "public", subject: "Launch", private: false});

    expect(consumer).toHaveBeenCalledTimes(1);
    expect(consumer).toHaveBeenCalledWith({id: "public", subject: "Launch"});
  });
});
