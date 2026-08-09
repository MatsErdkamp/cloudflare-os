import { DurableObject, RpcTarget } from "cloudflare:workers";
import { CONTRACT_HARNESS } from "@gadgets/contractors/runtime";
import type {
  ContractLifecycleEndpoint,
  ContractLifecycleSession,
  ContractReachabilitySnapshot,
  ContractRestorationReference,
} from "@gadgets/contractors/runtime";

const TEST_MAIN = `export {ContractFacet} from "contract-harness.js";`;

const CONTRACT_MODULE = `
  import {RpcTarget} from "cloudflare:workers";

  class RetainedCallback extends RpcTarget {
    deliver(value) { return "callback:" + value; }
  }

  class LocalChild extends RpcTarget {
    read() { return "local-child"; }
  }

  export function restoreContractCapability(_context, params) {
    return new class extends RpcTarget {
      read() { return "restored:" + params.value; }
    }();
  }

  export default (context) => new class extends RpcTarget {
    read() { return "root-live"; }
    child() { return new LocalChild(); }
    providerChild() { return context.source.child(); }
    pending() { return context.source.pending(); }
    registerCallback() { return context.source.retainCallback(new RetainedCallback()); }
    subscribe() { return context.source.subscribe(); }
    async restored() { return await context.restore({value: "bound"}); }
    restoreAccessor() {
      return context.restore(Object.defineProperty({}, "secret", {get() { return "unsafe"; }}));
    }
    rawReadable() { return new ReadableStream({start(controller) { controller.enqueue("unsafe"); }}); }
    rawWritable() { return new WritableStream(); }
    rawTransform() { return new TransformStream(); }
    rawIterator() { return {async *[Symbol.asyncIterator]() { yield "unsafe"; }}; }
    rawAbortSignal() {
      const controller = new AbortController();
      return context.source.waitForAbort(controller.signal);
    }
    waitForAbort(signal) { return context.source.waitForAbort(signal); }
    readThrough() { return context.source.read(); }
    async nested() {
      const first = await context.source.child();
      const second = await context.source.child();
      return {array: [first], map: new Map([["child", second]])};
    }
  }();
`;

type LifecycleEnv = Cloudflare.Env & { TEST_LOADER: WorkerLoader };

interface LifecycleRoot extends RpcTarget {
  read(): string;
  readThrough(): Promise<string>;
  child(): LifecycleChild;
  providerChild(): LifecycleChild;
  pending(): Promise<unknown>;
  registerCallback(): void;
  subscribe(): LifecycleSubscription;
  restored(): Promise<LifecycleRoot>;
  restoreAccessor(): unknown;
  rawReadable(): unknown;
  rawWritable(): unknown;
  rawTransform(): unknown;
  rawIterator(): unknown;
  rawAbortSignal(): unknown;
  nested(): Promise<{
    array: LifecycleChild[];
    map: Map<string, LifecycleChild>;
  }>;
}

interface RetainedCallbackCapability extends RpcTarget {
  deliver(value: string): Promise<unknown>;
  dup(): RetainedCallbackCapability;
}

type LifecycleFacetRpc = DurableObject & ContractLifecycleEndpoint & {
  startSession(session: ContractLifecycleSession): Promise<LifecycleRoot>;
  restoreSession(
    session: ContractLifecycleSession,
    reference: ContractRestorationReference,
  ): Promise<LifecycleRoot>;
};

class LifecycleChild extends RpcTarget {
  read(): string { return "provider-child"; }
}

class LifecycleSubscription extends RpcTarget {
  constructor(private readonly host: ContractLifecycleConformanceHost) { super(); }
  ping(): string { return "subscribed"; }
  [Symbol.dispose](): void { this.host.recordSubscriptionDisposal(); }
}

class LifecycleSource extends RpcTarget {
  constructor(private readonly host: ContractLifecycleConformanceHost) { super(); }
  child(): LifecycleChild { return new LifecycleChild(); }
  read(): string { return "provider-live"; }
  pending(): Promise<unknown> { return this.host.providerPending(); }
  retainCallback(callback: RpcTarget): void { this.host.retainCallback(callback); }
  subscribe(): LifecycleSubscription { return new LifecycleSubscription(this.host); }
  waitForAbort(signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.resolve("aborted");
    return new Promise((resolve) => signal.addEventListener("abort", () => resolve("aborted"), {
      once: true,
    }));
  }
}

class LifecycleApproval extends RpcTarget {
  constructor(private readonly source: RpcTarget) { super(); }
  manual(_description: unknown, operation: (context: {source: RpcTarget}) => unknown): unknown {
    return operation({ source: this.source });
  }
  require(): void {}
}

class LifecycleObserver extends RpcTarget {
  constructor(private readonly host: ContractLifecycleConformanceHost) { super(); }
  observe(value: Record<string, unknown>): void | Promise<void> {
    return this.host.recordObservation(value);
  }
  [Symbol.dispose](): void { this.host.recordObserverDisposal(); }
}

class UpstreamCancellation extends RpcTarget {
  constructor(private readonly host: ContractLifecycleConformanceHost) { super(); }
  cancel(): void { this.host.recordUpstreamCancellation(); }
}

class UpstreamFacetCancellation extends RpcTarget {
  constructor(
    private readonly host: ContractLifecycleConformanceHost,
    private readonly facetId: string,
    private readonly generation: number,
  ) { super(); }
  cancel(): Promise<unknown> { return this.host.invalidateFacet(this.facetId, this.generation); }
}

class LifecycleRestoredProxy extends RpcTarget {
  constructor(
    private readonly host: ContractLifecycleConformanceHost,
    private readonly reference: Record<string, unknown>,
  ) { super(); }
  read(): Promise<unknown> { return this.host.invokeRestored(this.reference, "read", []); }
}

class LifecycleRestorer extends RpcTarget {
  constructor(private readonly host: ContractLifecycleConformanceHost) { super(); }
  restore(reference: Record<string, unknown>): LifecycleRestoredProxy {
    this.host.recordRestorationReference(reference);
    return new LifecycleRestoredProxy(this.host, reference);
  }
}

/** Dedicated host for runtime-harness lifecycle and invalidation conformance. */
export class ContractLifecycleConformanceHost extends DurableObject<LifecycleEnv> {
  #retainedCallback?: RetainedCallbackCapability;
  #pending?: { promise: Promise<unknown>; resolve: (value: unknown) => void };
  #observations: Array<Record<string, unknown>> = [];
  #observerDisposals = 0;
  #observationDelayMs = 0;
  #subscriptionDisposals = 0;
  #upstreamCancellations = 0;
  #restorationReference?: Record<string, unknown>;

  #snapshot(generation = 1): ContractReachabilitySnapshot {
    return {
      endpointId: `endpoint:${this.ctx.id}`,
      instanceId: `instance:${this.ctx.id}`,
      instanceGeneration: 1,
      artifactHash: "sha256:lifecycle-artifact",
      runtimeProfileHash: "sha256:lifecycle-profile",
      reachabilityId: `reachability:${this.ctx.id}`,
      reachabilityGeneration: generation,
      authoritySnapshotDigest: `sha256:authority:${generation}`,
      compositionLineage: [`endpoint:${this.ctx.id}`],
      chainDepth: 0,
      maxChainDepth: 8,
    };
  }

  #worker() {
    return this.env.TEST_LOADER.get(`contract-lifecycle:${this.ctx.id}`, () => ({
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

  #facet(): Fetcher<LifecycleFacetRpc> {
    return this.#namedFacet("lifecycle");
  }

  #namedFacet(facetId: string): Fetcher<LifecycleFacetRpc> {
    return this.ctx.facets.get<LifecycleFacetRpc>(facetId, () => ({
      class: this.#worker().getDurableObjectClass<LifecycleFacetRpc>("ContractFacet"),
      id: facetId,
    }));
  }

  #namedSnapshot(facetId: string, chainDepth: number, lineage: readonly string[]) {
    return {
      ...this.#snapshot(),
      endpointId: `endpoint:${this.ctx.id}:${facetId}`,
      instanceId: `instance:${this.ctx.id}:${facetId}`,
      reachabilityId: `reachability:${this.ctx.id}:${facetId}`,
      compositionLineage: lineage,
      chainDepth,
    };
  }

  async #session() {
    const source = new LifecycleSource(this);
    return this.#sessionWith(source, this.#snapshot());
  }

  async #sessionWith(
    source: RpcTarget,
    reachability: ContractReachabilitySnapshot,
  ): Promise<ContractLifecycleSession> {
    return {
      source,
      approval: new LifecycleApproval(source),
      restorer: new LifecycleRestorer(this),
      reachability,
      invocation: {
        invocationId: "lifecycle-invocation",
        consumerId: "lifecycle-consumer",
        bindingId: "lifecycle-binding",
        contractInstanceId: "lifecycle-instance",
        artifactHash: "sha256:lifecycle-artifact",
        runtimeProfileHash: "sha256:lifecycle-profile",
        methodName: "fixture",
        startedAt: 1,
        authoritySnapshotDigest: "sha256:authority:1",
        generations: {
          consumer: 1,
          binding: 1,
          contractInstance: 1,
          environment: 1,
          authority: 1,
        },
      },
      contract: { id: "lifecycle-instance", artifactHash: "sha256:lifecycle-artifact" },
    };
  }

  async install(): Promise<unknown> {
    return this.#facet().install(
      this.#snapshot(),
      new LifecycleObserver(this),
      new UpstreamCancellation(this),
    );
  }

  async installAgain(): Promise<unknown> { return this.install(); }

  async openRoot(): Promise<LifecycleRoot> {
    return this.#facet().startSession(await this.#session());
  }

  async invalidate(): Promise<unknown> {
    return this.#facet().invalidate(1);
  }

  async invalidateInParallel(): Promise<unknown> {
    const [first, second] = await Promise.all([
      this.#facet().invalidate(1),
      this.#facet().invalidate(1),
    ]);
    return {first, second, upstreamCancellations: this.#upstreamCancellations};
  }

  async installWhileInvalidating(): Promise<unknown> {
    await this.#facet().beginInvalidation(1);
    const [installAcknowledgement, invalidationAcknowledgement] = await Promise.all([
      this.install(),
      this.invalidate(),
    ]);
    return {
      installAcknowledgement,
      invalidationAcknowledgement,
      upstreamCancellations: this.#upstreamCancellations,
    };
  }

  async invalidateFacet(facetId: string, generation: number): Promise<unknown> {
    return this.#namedFacet(facetId).invalidate(generation);
  }

  async recoverPreparedInvalidation(): Promise<unknown> {
    await this.#facet().beginInvalidation(1);
    this.ctx.facets.abort("lifecycle", "injected restart after durable invalidation prepare");
    return this.#facet().install(
      this.#snapshot(),
      new LifecycleObserver(this),
      new UpstreamCancellation(this),
    );
  }

  async exerciseComposition(): Promise<{
    readonly live: unknown;
    readonly downstreamInvalidated: boolean;
    readonly upstreamInvalidated: boolean;
    readonly downstreamRootRejected: boolean;
    readonly upstreamRootRejected: boolean;
  }> {
    const downstreamId = "chain-downstream";
    const upstreamId = "chain-upstream";
    const downstreamEndpoint = `endpoint:${this.ctx.id}:${downstreamId}`;
    const upstreamEndpoint = `endpoint:${this.ctx.id}:${upstreamId}`;
    const upstreamSnapshot = this.#namedSnapshot(
      upstreamId,
      1,
      [downstreamEndpoint, upstreamEndpoint],
    );
    const upstreamSource = new LifecycleSource(this);
    const upstream = this.#namedFacet(upstreamId);
    await upstream.install(
      upstreamSnapshot,
      new LifecycleObserver(this),
      new UpstreamCancellation(this),
    );
    const upstreamRoot = await upstream.startSession(
      await this.#sessionWith(upstreamSource, upstreamSnapshot),
    );

    const downstreamSnapshot = this.#namedSnapshot(downstreamId, 0, [downstreamEndpoint]);
    const downstream = this.#namedFacet(downstreamId);
    await downstream.install(
      downstreamSnapshot,
      new LifecycleObserver(this),
      new UpstreamFacetCancellation(this, upstreamId, 1),
    );
    const downstreamRoot = await downstream.startSession(
      await this.#sessionWith(upstreamRoot, downstreamSnapshot),
    );
    const live = await downstreamRoot.readThrough();
    const downstreamAck = await downstream.invalidate(1);
    const upstreamAck = await upstream.invalidate(1);
    const downstreamRootRejected = await downstreamRoot.readThrough().then(
      () => false,
      () => true,
    );
    const upstreamRootRejected = await upstreamRoot.read().then(
      () => false,
      () => true,
    );
    return {
      live,
      downstreamInvalidated: downstreamAck.invalidated,
      upstreamInvalidated: upstreamAck.invalidated,
      downstreamRootRejected,
      upstreamRootRejected,
    };
  }

  async invalidCompositionDepthOutcome(): Promise<string> {
    const facetId = "invalid-depth";
    const endpoint = `endpoint:${this.ctx.id}:${facetId}`;
    try {
      await this.#namedFacet(facetId).install(
        this.#namedSnapshot(facetId, 9, [
          "parent-0", "parent-1", "parent-2", "parent-3", "parent-4",
          "parent-5", "parent-6", "parent-7", "parent-8", endpoint,
        ]),
        new LifecycleObserver(this),
        new UpstreamCancellation(this),
      );
      return "installed";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async exercisePendingInvalidation(): Promise<{
    readonly outcomes: readonly ("rejected" | "released")[];
    readonly cancelledInvocations: number;
    readonly observations: readonly string[];
  }> {
    const root = await this.openRoot();
    const outcomePromises = [root.pending(), root.pending()].map(pending => pending.then(
        () => "released" as const,
        () => "rejected" as const));
    while (!this.#pending) await scheduler.wait(0);
    const acknowledgement = await this.invalidate() as {cancelledInvocations: number};
    this.releasePending();
    const outcomes = await Promise.all(outcomePromises);
    while (!this.#observations.some((event) => event.type === "resultQuarantined")) {
      await scheduler.wait(0);
    }
    return {
      outcomes,
      cancelledInvocations: acknowledgement.cancelledInvocations,
      observations: this.#observations.map((event) => String(event.type)),
    };
  }

  async exerciseDelayedObservationDrain(): Promise<{
    readonly observations: readonly string[];
    readonly observerDisposals: number;
  }> {
    this.#observationDelayMs = 50;
    const root = await this.openRoot();
    const pending = root.pending().catch(() => undefined);
    while (!this.#pending) await scheduler.wait(0);
    await this.invalidate();
    this.releasePending();
    await pending;
    while (this.#observerDisposals === 0) await scheduler.wait(0);
    return {
      observations: this.#observations.map(event => String(event.type)),
      observerDisposals: this.#observerDisposals,
    };
  }

  async providerPending(): Promise<unknown> {
    if (!this.#pending) {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((done) => { resolve = done; });
      this.#pending = { promise, resolve };
    }
    return this.#pending.promise;
  }

  pendingStarted(): boolean { return this.#pending !== undefined; }

  releasePending(): void {
    this.#pending?.resolve(new LifecycleChild());
    this.#pending = undefined;
  }

  retainCallback(callback: RpcTarget): void {
    this.#retainedCallback = (callback as RetainedCallbackCapability).dup();
  }

  invokeRetained(): Promise<unknown> {
    if (!this.#retainedCallback) throw new Error("No retained callback.");
    return this.#retainedCallback.deliver("provider");
  }

  recordSubscriptionDisposal(): void { this.#subscriptionDisposals += 1; }
  subscriptionDisposals(): number { return this.#subscriptionDisposals; }
  recordUpstreamCancellation(): void { this.#upstreamCancellations += 1; }
  upstreamCancellations(): number { return this.#upstreamCancellations; }
  recordObservation(value: Record<string, unknown>): void | Promise<void> {
    if (this.#observationDelayMs === 0) {
      this.#observations.push(value);
      return;
    }
    return scheduler.wait(this.#observationDelayMs).then(() => {
      this.#observations.push(value);
    });
  }
  observations(): Array<Record<string, unknown>> { return structuredClone(this.#observations); }
  recordObserverDisposal(): void { this.#observerDisposals += 1; }
  observerDisposals(): number { return this.#observerDisposals; }

  async invokeRestored(
    reference: Record<string, unknown>,
    methodName: string,
    args: unknown[],
  ): Promise<unknown> {
    const capability = await this.#facet().restoreSession(await this.#session(), reference);
    const method = Reflect.get(capability as object, methodName);
    if (typeof method !== "function") throw new TypeError("No restored fixture method.");
    return Reflect.apply(method, capability, args);
  }

  recordRestorationReference(reference: Record<string, unknown>): void {
    this.#restorationReference = structuredClone(reference);
  }

  async restoreWithChangedField(field: string, value: unknown): Promise<string> {
    if (!this.#restorationReference) throw new Error("No restoration reference.");
    try {
      await this.#facet().restoreSession(await this.#session(), {
        ...this.#restorationReference,
        [field]: value,
      });
      return "restored";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async unsafeRestorationOutcome(): Promise<string> {
    const root = await this.openRoot();
    try {
      await root.restoreAccessor();
      return "restored";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
