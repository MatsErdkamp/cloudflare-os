import { DurableObject, RpcTarget } from "cloudflare:workers";
import {
  CONTRACT_HARNESS,
  CONTRACT_HARNESS_V8,
  contractHarnessForVersion,
} from "@gadgets/contractors/runtime";
import { bridgeContractSource } from "../src/overseer.js";

const CONTRACT_MODULE = `
  import {DurableObject, RpcTarget, env} from "cloudflare:workers";

  class Child extends RpcTarget {
    constructor(value) { super(); this.value = value; }
    read() { return this.value; }
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
`;

const HISTORICAL_CONTRACT_MODULE = `
  import {RpcTarget} from "cloudflare:workers";
  export default () => new class extends RpcTarget {
    read() { return "historical-live"; }
  }();
`;

const V8_EVIDENCE_CONTRACT_MODULE = `
  import {RpcTarget} from "cloudflare:workers";
  export default (context) => new class extends RpcTarget {
    inspect() {
      let mutationRejected = false;
      try { context.invocation.generations.binding = 999; }
      catch { mutationRejected = true; }
      return {
        fields: Object.keys(context.invocation).sort(),
        generationFields: Object.keys(context.invocation.generations).sort(),
        bindingGeneration: context.invocation.generations.binding,
        frozen: Object.isFrozen(context.invocation),
        generationsFrozen: Object.isFrozen(context.invocation.generations),
        mutationRejected,
      };
    }
  }();
`;

type FixtureEnv = Cloudflare.Env & {
  TEST_LOADER: WorkerLoader;
  TEST_CONTRACT_SOURCE: {startSession(): Promise<any>};
};

class FixtureApproval extends RpcTarget {
  constructor(private readonly source: any) { super(); }
  [Symbol.dispose](): void { this.source[Symbol.dispose](); }
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
      compatibilityDate: "2026-07-29",
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

  #contractFacet(): any {
    return this.ctx.facets.get("contract", () => ({
      class: this.#worker().getDurableObjectClass("ContractFacet"),
      id: "contract",
    }));
  }

  async #session() {
    const source = bridgeContractSource(await this.env.TEST_CONTRACT_SOURCE.startSession());
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

  async invokeHistorical(version: string): Promise<string> {
    const worker = this.env.TEST_LOADER.get(
      `contract-historical:${version}:${this.ctx.id}`,
      () => ({
        compatibilityDate: "2026-07-29",
        compatibilityFlags: ["allow_irrevocable_stub_storage"],
        mainModule: "test-main.js",
        modules: {
          "test-main.js": TEST_MAIN,
          "contract-harness.js": contractHarnessForVersion(version),
          "contract.js": HISTORICAL_CONTRACT_MODULE,
        },
        env: {},
        globalOutbound: null,
      }),
    );
    const facet = this.ctx.facets.get(`historical-${version}`, () => ({
      class: worker.getDurableObjectClass("ContractFacet"),
      id: `historical-${version}`,
    }));
    return facet.startSession(await this.#session()).then((root: any) => root.read());
  }

  async inspectV8Invocation(): Promise<unknown> {
    const worker = this.env.TEST_LOADER.get(`contract-v8-evidence:${this.ctx.id}`, () => ({
      compatibilityDate: "2026-07-29",
      compatibilityFlags: ["allow_irrevocable_stub_storage"],
      mainModule: "test-main.js",
      modules: {
        "test-main.js": TEST_MAIN,
        "contract-harness.js": CONTRACT_HARNESS_V8,
        "contract.js": V8_EVIDENCE_CONTRACT_MODULE,
      },
      env: {},
      globalOutbound: null,
    }));
    const facet = this.ctx.facets.get("v8-evidence", () => ({
      class: worker.getDurableObjectClass("ContractFacet"),
      id: "v8-evidence",
    }));
    const legacySession = await this.#session();
    const generations = {
      consumer: 1,
      binding: 2,
      contractInstance: 3,
      environment: 4,
      authority: 5,
    };
    const root = await facet.startSession({
      source: legacySession.source,
      approval: legacySession.policy.approval,
      restorer: legacySession.restorer,
      invocation: {
        schemaVersion: 1,
        invocationId: "invocation-v8",
        consumerId: "consumer-v8",
        bindingId: "binding-v8",
        contractInstanceId: "instance-v8",
        artifactHash: "sha256:artifact",
        runtimeProfileHash: "sha256:profile",
        methodName: "inspect",
        startedAt: 1,
        authoritySnapshotDigest: "sha256:snapshot",
        generations,
      },
      contract: legacySession.contract,
    });
    return root.inspect();
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
