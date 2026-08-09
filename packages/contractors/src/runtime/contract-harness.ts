import {
  CONTRACT_MAX_COMPOSITION_DEPTH,
  CONTRACT_OBSERVER_DRAIN_TIMEOUT_MS,
} from "./capability-lifecycle.js";

export {
  CONTRACT_MAX_COMPOSITION_DEPTH,
  CONTRACT_OBSERVER_DRAIN_TIMEOUT_MS,
} from "./capability-lifecycle.js";

/** Current standalone Dynamic Worker Contract harness. */
export const CONTRACT_HARNESS = `
import { DurableObject, RpcStub, RpcTarget, restore } from "cloudflare:workers";
import createContract, * as contractModule from "contract.js";

const SNAPSHOT_FIELDS = [
  "artifactHash", "authoritySnapshotDigest", "chainDepth", "compositionLineage",
  "endpointId", "instanceGeneration", "instanceId", "maxChainDepth",
  "reachabilityGeneration", "reachabilityId", "runtimeProfileHash",
];
const INVOCATION_FIELDS = [
  "artifactHash", "authoritySnapshotDigest", "bindingId", "consumerId",
  "contractInstanceId", "generations", "invocationId", "methodName",
  "runtimeProfileHash", "startedAt",
];
const INVOCATION_GENERATION_FIELDS = [
  "authority", "binding", "consumer", "contractInstance", "environment",
];
const RESTORATION_REFERENCE_FIELDS = [
  "artifactHash", "authoritySnapshotDigest", "endpointId", "instanceGeneration",
  "instanceId", "reachabilityGeneration", "reachabilityId", "restorationId",
  "runtimeProfileHash",
];

function sameSnapshot(left, right) {
  return left.endpointId === right.endpointId &&
    left.instanceId === right.instanceId &&
    left.instanceGeneration === right.instanceGeneration &&
    left.artifactHash === right.artifactHash &&
    left.runtimeProfileHash === right.runtimeProfileHash &&
    left.reachabilityId === right.reachabilityId &&
    left.reachabilityGeneration === right.reachabilityGeneration &&
    left.authoritySnapshotDigest === right.authoritySnapshotDigest &&
    left.chainDepth === right.chainDepth && left.maxChainDepth === right.maxChainDepth &&
    left.compositionLineage.join("\\0") === right.compositionLineage.join("\\0");
}

function closedSnapshot(input) {
  if (!input || typeof input !== "object" ||
      Object.keys(input).sort().join("\\0") !== SNAPSHOT_FIELDS.join("\\0")) {
    throw new TypeError("Contract reachability snapshot is not closed.");
  }
  for (const field of ["endpointId", "instanceId", "artifactHash", "runtimeProfileHash",
    "reachabilityId", "authoritySnapshotDigest"]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new TypeError("Contract reachability snapshot has an invalid " + field + ".");
    }
  }
  for (const field of ["instanceGeneration", "reachabilityGeneration", "chainDepth", "maxChainDepth"]) {
    if (!Number.isSafeInteger(input[field]) || input[field] < 0) {
      throw new TypeError("Contract reachability snapshot has an invalid " + field + ".");
    }
  }
  if (input.maxChainDepth > ${CONTRACT_MAX_COMPOSITION_DEPTH} ||
      input.chainDepth > input.maxChainDepth ||
      input.compositionLineage.length !== input.chainDepth + 1 ||
      input.compositionLineage.at(-1) !== input.endpointId ||
      new Set(input.compositionLineage).size !== input.compositionLineage.length) {
    throw new TypeError("Contract composition lineage is invalid.");
  }
  return Object.freeze({...input, compositionLineage: Object.freeze([...input.compositionLineage])});
}

function closedInvocationEvidence(invocation) {
  if (!invocation || typeof invocation !== "object" ||
      Object.keys(invocation).sort().join("\\0") !== INVOCATION_FIELDS.join("\\0")) {
    throw new TypeError("Contract invocation evidence has unknown or missing fields.");
  }
  const generationKeys = Object.keys(invocation.generations ?? {}).sort();
  if (generationKeys.join("\\0") !== INVOCATION_GENERATION_FIELDS.join("\\0")) {
    throw new TypeError("Contract invocation evidence has unknown or missing generations.");
  }
  return Object.freeze({
    invocationId: invocation.invocationId,
    consumerId: invocation.consumerId,
    bindingId: invocation.bindingId,
    contractInstanceId: invocation.contractInstanceId,
    artifactHash: invocation.artifactHash,
    runtimeProfileHash: invocation.runtimeProfileHash,
    methodName: invocation.methodName,
    startedAt: invocation.startedAt,
    authoritySnapshotDigest: invocation.authoritySnapshotDigest,
    generations: Object.freeze(Object.fromEntries(
      INVOCATION_GENERATION_FIELDS.map((name) => [name, invocation.generations[name]]))),
  });
}

function capabilityFreeParams(value, depth = 0, nodes = {value: 0}, seen = new WeakMap()) {
  if (depth > 32 || ++nodes.value > 4096) {
    throw new TypeError("Contract restoration params exceed lifecycle limits.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value))) {
    return value;
  }
  if (typeof value !== "object" || value instanceof ReadableStream ||
      value instanceof WritableStream || value instanceof TransformStream ||
      value instanceof AbortSignal || Symbol.asyncIterator in value) {
    throw new TypeError("Contract restoration params must be capability-free data.");
  }
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    for (const child of value) clone.push(capabilityFreeParams(child, depth + 1, nodes, seen));
    return Object.freeze(clone);
  }
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new TypeError("Contract restoration params must be plain string-keyed data.");
  }
  const clone = Object.create(prototype);
  seen.set(value, clone);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor)) {
      throw new TypeError("Contract restoration params cannot contain accessors.");
    }
    clone[key] = capabilityFreeParams(descriptor.value, depth + 1, nodes, seen);
  }
  return Object.freeze(clone);
}

function createApproval(approval, gate) {
  return {
    manual(description, operation) {
      gate.assertActive();
      return gate.guardPromise(approval.manual(description, async ({source}) =>
        gate.guard(await operation({source: gate.guard(source.dup())}))));
    },
    require(description) {
      gate.assertActive();
      return gate.guardPromise(approval.require(description));
    },
  };
}

class LifecycleGate {
  constructor(snapshot, observer, upstreamCancellation) {
    this.snapshot = snapshot;
    this.observer = observer;
    this.upstreamCancellation = upstreamCancellation;
    this.controller = new AbortController();
    this.cleanup = new Set();
    this.wrappedCapabilities = new WeakMap();
    this.trackedStubs = new WeakSet();
    this.trackedDisposers = new WeakMap();
    this.observationDeliveries = new Set();
    this.lateSettlements = new Set();
    this.invocationDepth = 0;
    this.activeInvocations = 0;
    this.active = true;
  }

  observe(type, fields = {}) {
    if (!this.observer) return;
    try {
      const delivery = Promise.resolve(this.observer.observe({
        type, endpointId: this.snapshot.endpointId,
        reachabilityGeneration: this.snapshot.reachabilityGeneration, ...fields,
      })).catch(() => undefined);
      this.observationDeliveries.add(delivery);
      delivery.finally(() => this.observationDeliveries.delete(delivery));
    } catch {}
  }

  trackStub(stub) {
    if (!stub || this.trackedStubs.has(stub)) return stub;
    this.trackedStubs.add(stub);
    if (typeof stub[Symbol.dispose] === "function") {
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        stub[Symbol.dispose]();
      };
      this.trackedDisposers.set(stub, dispose);
      this.cleanup.add(dispose);
    }
    return stub;
  }

  disposeStub(stub) {
    this.trackedDisposers.get(stub)?.();
  }

  assertActive() {
    if (!this.active) throw new Error("Contract reachability is invalidated.");
  }

  closeRelease() {
    if (!this.active) return;
    this.active = false;
    this.controller.abort();
  }

  async cleanupResources() {
    const cleanup = [...this.cleanup];
    this.cleanup.clear();
    if (this.upstreamCancellation) {
      const upstreamCancellation = this.upstreamCancellation;
      this.upstreamCancellation = undefined;
      cleanup.push(async () => {
        try { await upstreamCancellation.cancel(this.snapshot); }
        finally { upstreamCancellation[Symbol.dispose]?.(); }
      });
    }
    const results = await Promise.allSettled(cleanup.map((operation) => operation()));
    const cleanupFailures = results.filter((result) => result.status === "rejected").length;
    return {cleanupFailures};
  }

  disposeObserverAfterDeliveries() {
    const observer = this.observer;
    if (!observer) return;
    const deadlineAt = Date.now() + ${CONTRACT_OBSERVER_DRAIN_TIMEOUT_MS};
    const drain = async () => {
      while (Date.now() < deadlineAt) {
        const pending = [...this.observationDeliveries, ...this.lateSettlements];
        if (pending.length === 0) return;
        const remaining = deadlineAt - Date.now();
        const outcome = await Promise.race([
          Promise.allSettled(pending).then(() => "settled"),
          new Promise((resolve) => setTimeout(() => resolve("deadline"), remaining)),
        ]);
        if (outcome === "deadline") return;
        await Promise.resolve();
      }
    };
    drain().finally(() => {
      if (this.observer === observer) this.observer = undefined;
      try { observer[Symbol.dispose]?.(); } catch {}
    }).catch(() => undefined);
  }

  guardPromise(value) {
    this.assertActive();
    this.activeInvocations += 1;
    const pending = Promise.resolve(value);
    const settled = pending.then(
      (result) => ({status: "fulfilled", result}),
      (error) => ({status: "rejected", error}));
    const invalidated = new Promise((resolve) => this.controller.signal.addEventListener(
      "abort", () => resolve({status: "invalidated"}), {once: true}));
    const lateSettlement = pending.then((late) => {
      if (!this.active) {
        try { late?.[Symbol.dispose]?.(); } catch {}
        this.observe("resultQuarantined", {outcome: "quarantined"});
      }
    }, () => undefined);
    this.lateSettlements.add(lateSettlement);
    lateSettlement.finally(() => this.lateSettlements.delete(lateSettlement));
    return Promise.race([settled, invalidated]).then((outcome) => {
      if (outcome.status === "invalidated") {
        throw new Error("Contract reachability is invalidated.");
      }
      if (outcome.status === "rejected") throw outcome.error;
      this.assertActive();
      return this.guard(outcome.result);
    }).finally(() => { this.activeInvocations -= 1; });
  }

  invoke(target, property, args) {
    this.assertActive();
    const method = target[property];
    if (typeof method !== "function") {
      throw new TypeError("Lifecycle target method is unavailable: " + property + ".");
    }
    const nested = this.invocationDepth > 0;
    this.invocationDepth += 1;
    try {
      const result = Reflect.apply(method, target, args.map((arg) => this.guard(arg)));
      return nested ? result : this.guardPromise(result);
    } finally {
      this.invocationDepth -= 1;
    }
  }

  guard(value, seen = new WeakMap(), depth = 0, nodes = {value: 0}) {
    this.assertActive();
    if (depth > 32 || ++nodes.value > 4096) throw new TypeError("Capability graph exceeds limits.");
    if (value instanceof ReadableStream || value instanceof WritableStream ||
        value instanceof TransformStream) {
      const shape = value instanceof ReadableStream ? "readableStream" :
        value instanceof WritableStream ? "writableStream" : "transformStream";
      this.observe("unsupportedShapeRejected", {shape});
      throw new TypeError("Raw streams require a generation-gated mediator.");
    }
    if (value instanceof AbortSignal) {
      this.observe("unsupportedShapeRejected", {shape: "abortSignal"});
      throw new TypeError("Raw AbortSignal requires an explicit cancellation capability.");
    }
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
    const existing = seen.get(value);
    if (existing !== undefined) return existing;
    const lifecycleWrapped = this.wrappedCapabilities.get(value);
    if (lifecycleWrapped !== undefined) return lifecycleWrapped;
    if (value instanceof Promise) return this.guardPromise(value);
    if (value instanceof RpcStub || value instanceof RpcTarget) {
      const wrapped = new LifecycleCapability(value, this);
      seen.set(value, wrapped);
      this.wrappedCapabilities.set(value, wrapped);
      this.wrappedCapabilities.set(wrapped, wrapped);
      this.trackStub(value);
      return wrapped;
    }
    if (Symbol.asyncIterator in value) {
      this.observe("unsupportedShapeRejected", {shape: "asyncIterator"});
      throw new TypeError("Raw async iterators require the lifecycle cursor protocol.");
    }
    if (typeof value === "function") {
      const callback = (...args) => {
        this.assertActive();
        return this.guardPromise(value(...args.map((arg) => this.guard(arg))));
      };
      seen.set(value, callback);
      return callback;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) return value;
    if (Array.isArray(value)) {
      const wrapped = [];
      seen.set(value, wrapped);
      for (const child of value) wrapped.push(this.guard(child, seen, depth + 1, nodes));
      return wrapped;
    }
    if (value instanceof Map) {
      const wrapped = new Map();
      seen.set(value, wrapped);
      for (const [key, child] of value) {
        wrapped.set(this.guard(key, seen, depth + 1, nodes),
          this.guard(child, seen, depth + 1, nodes));
      }
      return wrapped;
    }
    if (value instanceof Set) {
      const wrapped = new Set();
      seen.set(value, wrapped);
      for (const child of value) wrapped.add(this.guard(child, seen, depth + 1, nodes));
      return wrapped;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Unsupported capability graph prototype.");
    }
    const wrapped = Object.create(prototype);
    seen.set(value, wrapped);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) throw new TypeError("Capability graphs cannot contain accessors.");
      wrapped[key] = this.guard(descriptor.value, seen, depth + 1, nodes);
    }
    return wrapped;
  }
}

class LifecycleCapability extends RpcTarget {
  constructor(target, gate) {
    super();
    return new Proxy(this, {
      get(_wrapper, property) {
        if (property === "then") return undefined;
        if (property === "dup" || property === "onRpcBroken") return undefined;
        if (property === Symbol.dispose) return () => gate.disposeStub(target);
        if (typeof property !== "string") return Reflect.get(_wrapper, property, _wrapper);
        return (...args) => gate.invoke(target, property, args);
      },
      getPrototypeOf() { return RpcTarget.prototype; },
    });
  }
}

export class ContractFacet extends DurableObject {
  gate;
  invalidationPromise;

  runInvalidation(operation) {
    if (this.invalidationPromise) return this.invalidationPromise;
    const pending = Promise.resolve().then(operation);
    this.invalidationPromise = pending;
    return pending.finally(() => {
      if (this.invalidationPromise === pending) this.invalidationPromise = undefined;
    });
  }

  async install(snapshot, observer, upstreamCancellation) {
    const exact = closedSnapshot(snapshot);
    const durable = this.ctx.storage.kv.get("contract:lifecycle");
    if (durable && !sameSnapshot(durable.snapshot, exact)) {
      throw new Error("Contract lifecycle installation snapshot mismatch.");
    }
    if (durable?.status === "invalidated") return durable.ack;
    if (this.gate) {
      if (!sameSnapshot(this.gate.snapshot, exact)) {
        throw new Error("Contract lifecycle installation snapshot mismatch.");
      }
      if (durable?.status === "invalidating") {
        this.gate.closeRelease();
        return this.runInvalidation(() => this.finishInvalidation(this.gate, durable));
      }
      return {endpointId: exact.endpointId, reachabilityGeneration: exact.reachabilityGeneration};
    }
    if (!durable) {
      this.ctx.storage.kv.put("contract:lifecycle", {status: "active", snapshot: exact});
      await this.ctx.storage.sync();
    }
    this.gate = new LifecycleGate(exact, observer?.dup(), upstreamCancellation?.dup());
    if (durable?.status === "invalidating") {
      this.gate.closeRelease();
      return this.runInvalidation(() => this.finishInvalidation(this.gate, durable));
    }
    this.gate.observe("installed");
    return {endpointId: exact.endpointId, reachabilityGeneration: exact.reachabilityGeneration};
  }

  requireGate(snapshot) {
    const exact = closedSnapshot(snapshot);
    if (!this.gate || !sameSnapshot(this.gate.snapshot, exact)) {
      throw new Error("Contract lifecycle endpoint is not installed for this snapshot.");
    }
    this.gate.assertActive();
    return this.gate;
  }

  createContext(session) {
    const gate = this.requireGate(session.reachability);
    const restorer = gate.trackStub(session.restorer.dup());
    const restore = (params) => {
      gate.assertActive();
      const restorationId = crypto.randomUUID();
      const record = Object.freeze({
        restorationId,
        endpointId: gate.snapshot.endpointId,
        instanceId: gate.snapshot.instanceId,
        instanceGeneration: gate.snapshot.instanceGeneration,
        artifactHash: gate.snapshot.artifactHash,
        runtimeProfileHash: gate.snapshot.runtimeProfileHash,
        reachabilityId: gate.snapshot.reachabilityId,
        reachabilityGeneration: gate.snapshot.reachabilityGeneration,
        authoritySnapshotDigest: gate.snapshot.authoritySnapshotDigest,
        params: capabilityFreeParams(params),
      });
      this.ctx.storage.kv.put("contract:restoration:" + restorationId, record);
      gate.observe("restorationCreated", {restorationId});
      const {params: _params, ...reference} = record;
      return restorer.restore(reference);
    };
    return {
      source: gate.guard(session.source.dup()),
      approval: createApproval(gate.trackStub(session.approval.dup()), gate),
      storage: this.ctx.storage,
      sharedState: session.sharedState ? gate.trackStub(session.sharedState.dup()) : undefined,
      invocation: closedInvocationEvidence(session.invocation),
      contract: session.contract,
      restore,
    };
  }

  async startSession(session) {
    const gate = this.requireGate(session.reachability);
    const binding = await createContract(this.createContext(session));
    if (!(binding instanceof RpcTarget)) throw new TypeError("Contract factory must return an RpcTarget.");
    return gate.guard(binding);
  }

  async restoreSession(session, reference) {
    const gate = this.requireGate(session.reachability);
    const restoreCapability = contractModule.restoreContractCapability;
    if (typeof restoreCapability !== "function") throw new Error("Contract does not support restoration.");
    const record = this.ctx.storage.kv.get("contract:restoration:" + reference.restorationId);
    if (!record || Object.keys(reference).sort().join("\\0") !==
        RESTORATION_REFERENCE_FIELDS.join("\\0") ||
        RESTORATION_REFERENCE_FIELDS.some((field) => reference[field] !== record[field]) ||
        !sameSnapshot(gate.snapshot, {...gate.snapshot,
      endpointId: record.endpointId, instanceId: record.instanceId,
      instanceGeneration: record.instanceGeneration, artifactHash: record.artifactHash,
      runtimeProfileHash: record.runtimeProfileHash, reachabilityId: record.reachabilityId,
      reachabilityGeneration: record.reachabilityGeneration,
      authoritySnapshotDigest: record.authoritySnapshotDigest})) {
      gate.observe("restorationRejected", {restorationId: reference.restorationId});
      throw new Error("Contract restoration authority is stale.");
    }
    const capability = await restoreCapability(this.createContext(session), record.params);
    if (!(capability instanceof RpcTarget)) throw new TypeError("Contract restorer must return an RpcTarget.");
    gate.observe("restored", {restorationId: reference.restorationId});
    return gate.guard(capability);
  }

  async finishInvalidation(gate, durable) {
    const {cleanupFailures} = await gate.cleanupResources();
    gate.observe("invalidated", {cleanupFailures});
    gate.disposeObserverAfterDeliveries();
    const ack = Object.freeze({
      endpointId: gate.snapshot.endpointId,
      reachabilityGeneration: gate.snapshot.reachabilityGeneration,
      invalidated: true,
      cancelledInvocations: durable.cancelledInvocations,
      cleanupFailures,
    });
    this.ctx.storage.kv.put("contract:lifecycle", {
      status: "invalidated", snapshot: gate.snapshot, ack,
    });
    await this.ctx.storage.sync();
    return ack;
  }

  async beginInvalidation(expectedReachabilityGeneration) {
    const existing = this.ctx.storage.kv.get("contract:lifecycle");
    if (existing?.status === "invalidated" || existing?.status === "invalidating") return existing;
    if (!this.gate || this.gate.snapshot.reachabilityGeneration !== expectedReachabilityGeneration) {
      throw new Error("Contract lifecycle invalidation generation mismatch.");
    }
    const cancelledInvocations = this.gate.activeInvocations;
    this.gate.observe("cancelRequested", {cancelledInvocations});
    const durable = {
      status: "invalidating", snapshot: this.gate.snapshot, cancelledInvocations,
    };
    this.ctx.storage.kv.put("contract:lifecycle", durable);
    await this.ctx.storage.sync();
    this.gate.closeRelease();
    return durable;
  }

  invalidate(expectedReachabilityGeneration) {
    return this.runInvalidation(async () => {
      const existing = await this.beginInvalidation(expectedReachabilityGeneration);
      if (existing?.status === "invalidated" &&
          existing.snapshot.reachabilityGeneration === expectedReachabilityGeneration) {
        return existing.ack;
      }
      if (!this.gate ||
          this.gate.snapshot.reachabilityGeneration !== expectedReachabilityGeneration) {
        throw new Error("Contract lifecycle invalidation generation mismatch.");
      }
      this.gate.closeRelease();
      return this.finishInvalidation(this.gate, existing);
    });
  }

  [restore]() {
    throw new Error("Platform restoration is disabled for lifecycle-bound Contracts.");
  }
}
`;
