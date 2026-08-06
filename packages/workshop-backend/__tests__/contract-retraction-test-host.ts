import { DurableObject, RpcTarget } from "cloudflare:workers";
import { CONTRACT_HARNESS } from "@gadgets/contractors/runtime";

const CONTRACT_MODULE = `
  import {DurableObject, RpcTarget, env} from "cloudflare:workers";

  class Child extends RpcTarget {
    constructor(value) { super(); this.value = value; }
    read() { return this.value; }
  }

  class Source extends RpcTarget {
    read() { return "source"; }
    child() { return new Child("source-child"); }
    cursor() { return new Child("cursor"); }
    mappedChild() { return new Map([["child", new Child("mapped-child")]]); }
  }

  export class SourceFacet extends DurableObject {
    startSession() { return new Source(); }
  }

  class ContractRoot extends RpcTarget {
    constructor(context) { super(); this.context = context; }
    read() { return "root"; }
    customChild() { return new Child("contract-child"); }
    delegatedSource() { return this.context.source; }
    delegatedChild() { return this.context.source.child(); }
    manualDelegatedSource() {
      return this.context.policy.approval.manual(
        {title: "Delegate", description: "Return manual Source"},
        ({source}) => source,
      );
    }
    manualDelegatedChild() {
      return this.context.policy.approval.manual(
        {title: "Delegate child", description: "Return manual Source child"},
        ({source}) => source.child(),
      );
    }
    cursor() { return this.context.source.cursor(); }
    mappedDelegation() { return this.context.source.mappedChild(); }
    functionValue() { return (value) => \`function:\${value}\`; }
    restored() { return this.context.restore({type: "fixture-restored"}); }
    bindingNames() { return Object.keys(env); }
    async networkBlocked() {
      try { await fetch("https://example.com/"); return false; }
      catch { return true; }
    }
    increment() {
      const next = (this.context.storage.kv.get("counter") || 0) + 1;
      this.context.storage.kv.put("counter", next);
      return next;
    }
  }

  export function restoreContractCapability(context, params) {
    if (params.type !== "fixture-restored") throw new TypeError("Unknown restoration.");
    return new class extends RpcTarget {
      async read() { return "restored:" + await context.source.read(); }
    }();
  }

  export default (context) => new ContractRoot(context);
`;

const TEST_MAIN = `
  export {ContractFacet} from "contract-harness.js";
  export {SourceFacet} from "contract.js";
`;

type FixtureEnv = Cloudflare.Env & {TEST_LOADER: WorkerLoader};

class FixtureApproval extends RpcTarget {
  constructor(private readonly source: any) { super(); }
  manual(_description: unknown, operation: (context: {source: unknown}) => unknown): unknown {
    return operation({source: this.source.dup()});
  }
  require(): never { throw new Error("Not used by this fixture."); }
}

class FixtureRestoredProxy extends RpcTarget {
  constructor(private readonly host: ContractRetractionTestHost, private readonly id: string) {
    super();
  }

  read(): Promise<unknown> {
    return this.host.invokeRestored(this.id, "read", []);
  }
}

class FixtureRestorer extends RpcTarget {
  constructor(private readonly host: ContractRetractionTestHost) {
    super();
  }

  restore(restorationId: string): FixtureRestoredProxy {
    return new FixtureRestoredProxy(this.host, restorationId);
  }
}

/** Test-only supervisor that exercises the exact production Contract harness and facet pattern. */
export class ContractRetractionTestHost extends DurableObject<FixtureEnv> {
  #active = true;

  #worker() {
    return this.env.TEST_LOADER.get(`contract-retraction:${this.ctx.id}`, () => ({
      compatibilityDate: "2026-08-05",
      compatibilityFlags: ["allow_irrevocable_stub_storage"],
      mainModule: "test-main.js",
      modules: {
        "test-main.js": TEST_MAIN,
        "contract-harness.js": CONTRACT_HARNESS,
        "contract.js": CONTRACT_MODULE,
      },
      env: {},
      globalOutbound: null,
    }));
  }

  #sourceFacet(): any {
    return this.ctx.facets.get("source", () => ({
      class: this.#worker().getDurableObjectClass("SourceFacet"),
      id: "source",
    }));
  }

  #contractFacet(): any {
    return this.ctx.facets.get("contract", () => ({
      class: this.#worker().getDurableObjectClass("ContractFacet"),
      id: "contract",
    }));
  }

  async #session() {
    const source = await this.#sourceFacet().startSession();
    return {
      source,
      policy: {approval: new FixtureApproval(source.dup())},
      restorer: new FixtureRestorer(this),
      caller: {from: "gadget", gadgetId: 9},
      contract: {id: "70", artifactHash: "sha256:fixture"},
    };
  }

  async #rootFor(): Promise<any> {
    return this.#contractFacet().startSession(await this.#session());
  }

  async openGraph(): Promise<Record<string, any>> {
    this.#active = true;
    return {
      root: await this.#rootFor(),
      customChild: await (await this.#rootFor()).customChild(),
      delegatedChild: await (await this.#rootFor()).delegatedChild(),
      manualDelegatedSource: await (await this.#rootFor()).manualDelegatedSource(),
      manualDelegatedChild: await (await this.#rootFor()).manualDelegatedChild(),
      cursor: await (await this.#rootFor()).cursor(),
      mappedDelegation: await (await this.#rootFor()).mappedDelegation(),
      functionValue: await (await this.#rootFor()).functionValue(),
      restored: await (await this.#rootFor()).restored(),
      delegatedSource: await (await this.#rootFor()).delegatedSource(),
    };
  }

  deleteContract(): void {
    this.#active = false;
    this.ctx.facets.delete("contract");
  }

  async increment(): Promise<number> {
    this.#active = true;
    return (await this.#rootFor()).increment();
  }

  async invokeRestored(restorationId: string, methodName: string, args: unknown[]): Promise<unknown> {
    if (!this.#active) throw new Error("Contract deleted.");
    const capability = await this.#contractFacet().restoreSession(
        await this.#session(), restorationId);
    const method = Reflect.get(capability as object, methodName);
    if (typeof method !== "function") throw new TypeError("No such restored fixture method.");
    return Reflect.apply(method, capability, args);
  }
}
