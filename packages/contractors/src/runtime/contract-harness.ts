/** Version included in the content hash whenever harness behavior changes. */
export const CONTRACT_RUNTIME_HARNESS_VERSION = "7";

/** Additive direct-approval harness version used only by Artifact v2. */
export const CONTRACT_RUNTIME_HARNESS_V8_VERSION = "8";

const CONTRACT_HARNESS_V1 = `
import { DurableObject, RpcTarget, restore } from "cloudflare:workers";
import createContract, * as contractModule from "contract.js";

export class ContractFacet extends DurableObject {
  async startSession(session) {
    const context = {
      source: session.source,
      policy: session.policy,
      storage: this.ctx.storage,
      sharedState: session.sharedState,
      caller: session.caller,
      contract: session.contract,
      restore: (params) => this.ctx.restore(params),
    };

    const binding = await createContract(context);
    if (!(binding instanceof RpcTarget)) {
      throw new TypeError("Contract factory must return an RpcTarget.");
    }
    return binding;
  }

  [restore](params) {
    const restoreCapability = contractModule.restoreContractCapability;
    if (typeof restoreCapability !== "function") {
      throw new Error("Contract does not support restored capabilities.");
    }

    return restoreCapability({
      storage: this.ctx.storage,
      restore: (childParams) => this.ctx.restore(childParams),
    }, params);
  }
}
`;

const CONTRACT_HARNESS_V2 = `
import { DurableObject, RpcTarget, restore } from "cloudflare:workers";
import createContract, * as contractModule from "contract.js";

export class ContractFacet extends DurableObject {
  async startSession(session) {
    const context = {
      source: session.source.dup(),
      policy: {approval: session.policy.approval.dup()},
      storage: this.ctx.storage,
      sharedState: session.sharedState?.dup(),
      caller: session.caller,
      contract: session.contract,
      restore: (params) => this.ctx.restore(params),
    };

    const binding = await createContract(context);
    if (!(binding instanceof RpcTarget)) {
      throw new TypeError("Contract factory must return an RpcTarget.");
    }
    return binding;
  }

  [restore](params) {
    const restoreCapability = contractModule.restoreContractCapability;
    if (typeof restoreCapability !== "function") {
      throw new Error("Contract does not support restored capabilities.");
    }

    return restoreCapability({
      storage: this.ctx.storage,
      restore: (childParams) => this.ctx.restore(childParams),
    }, params);
  }
}
`;

/** Versioned Dynamic Worker harness combined with every immutable artifact. */
const CONTRACT_HARNESS_V3 = `
import { DurableObject, RpcTarget, restore } from "cloudflare:workers";
import createContract, * as contractModule from "contract.js";

export class ContractFacet extends DurableObject {
  createContext(session) {
    const restore = (params) => {
      const restorationId = crypto.randomUUID();
      this.ctx.storage.kv.put("contract:restoration:" + restorationId, params);
      return session.restorer.restore(restorationId);
    };
    return {
      source: session.source.dup(),
      policy: {approval: session.policy.approval.dup()},
      storage: this.ctx.storage,
      sharedState: session.sharedState?.dup(),
      caller: session.caller,
      contract: session.contract,
      restore,
    };
  }

  async startSession(session) {
    const binding = await createContract(this.createContext(session));
    if (!(binding instanceof RpcTarget)) {
      throw new TypeError("Contract factory must return an RpcTarget.");
    }
    return binding;
  }

  async restoreSession(session, restorationId) {
    const restoreCapability = contractModule.restoreContractCapability;
    if (typeof restoreCapability !== "function") {
      throw new Error("Contract does not support restored capabilities.");
    }
    const key = "contract:restoration:" + restorationId;
    const params = this.ctx.storage.kv.get(key);
    if (params === undefined) throw new Error("Contract restoration does not exist.");
    const capability = await restoreCapability(this.createContext(session), params);
    if (!(capability instanceof RpcTarget)) {
      throw new TypeError("Contract restorer must return an RpcTarget.");
    }
    return capability;
  }

  [restore](params) {
    const restoreCapability = contractModule.restoreContractCapability;
    if (typeof restoreCapability !== "function") {
      throw new Error("Contract does not support restored capabilities.");
    }
    return restoreCapability({
      storage: this.ctx.storage,
      restore: (childParams) => this.ctx.restore(childParams),
    }, params);
  }
}
`;

const LIFECYCLE_MEMBRANE_V4 = `
function wrapCapability(value) {
  if (value instanceof RpcStub) return new LifecycleCapability(value);
  if (typeof value === "function") {
    return (...args) => Promise.resolve(value(...args)).then(wrapCapability);
  }
  if (Array.isArray(value)) return value.map(wrapCapability);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(Object.entries(value).map(
        ([key, child]) => [key, wrapCapability(child)]));
    }
  }
  return value;
}

class LifecycleCapability extends RpcTarget {
  constructor(target) {
    super();
    return new Proxy(this, {
      get(_wrapper, property) {
        if (property === "then") return undefined;
        if (typeof property !== "string") return Reflect.get(_wrapper, property, _wrapper);
        return (...args) => Promise.resolve(target[property](...args)).then(wrapCapability);
      },
      getPrototypeOf() { return RpcTarget.prototype; },
    });
  }
}
`;

/** Versioned Dynamic Worker harness combined with every immutable artifact. */
const CONTRACT_HARNESS_V4 = CONTRACT_HARNESS_V3
  .replace(
    'import { DurableObject, RpcTarget, restore } from "cloudflare:workers";',
    'import { DurableObject, RpcStub, RpcTarget, restore } from "cloudflare:workers";',
  )
  .replace(
    'export class ContractFacet extends DurableObject {',
    `${LIFECYCLE_MEMBRANE_V4}\nexport class ContractFacet extends DurableObject {`,
  )
  .replace('source: session.source.dup(),', 'source: wrapCapability(session.source.dup()),');

const CONTRACT_HARNESS_V5 = CONTRACT_HARNESS_V4
  .replace(
    '  createContext(session) {\n    const restore = (params) => {',
    '  createContext(session) {\n    const restorer = session.restorer.dup();\n' +
      '    const restore = (params) => {',
  )
  .replace('return session.restorer.restore(restorationId);',
    'return restorer.restore(restorationId);');

const LIFECYCLE_MEMBRANE_V6 = `
function wrapCapability(value, seen = new WeakMap()) {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    const existing = seen.get(value);
    if (existing !== undefined) return existing;
  }
  if (value instanceof RpcStub) {
    const wrapped = new LifecycleCapability(value);
    seen.set(value, wrapped);
    return wrapped;
  }
  if (typeof value === "function") {
    const wrapped = (...args) => Promise.resolve(value(...args)).then(
      (result) => wrapCapability(result));
    seen.set(value, wrapped);
    return wrapped;
  }
  if (Array.isArray(value)) {
    const wrapped = [];
    seen.set(value, wrapped);
    for (const child of value) wrapped.push(wrapCapability(child, seen));
    return wrapped;
  }
  if (value instanceof Map) {
    const wrapped = new Map();
    seen.set(value, wrapped);
    for (const [key, child] of value) {
      wrapped.set(wrapCapability(key, seen), wrapCapability(child, seen));
    }
    return wrapped;
  }
  if (value instanceof Set) {
    const wrapped = new Set();
    seen.set(value, wrapped);
    for (const child of value) wrapped.add(wrapCapability(child, seen));
    return wrapped;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      const wrapped = Object.create(prototype);
      seen.set(value, wrapped);
      for (const [key, child] of Object.entries(value)) {
        wrapped[key] = wrapCapability(child, seen);
      }
      return wrapped;
    }
  }
  return value;
}

class LifecycleCapability extends RpcTarget {
  constructor(target) {
    super();
    return new Proxy(this, {
      get(_wrapper, property) {
        if (property === "then") return undefined;
        if (typeof property !== "string") return Reflect.get(_wrapper, property, _wrapper);
        return (...args) => Promise.resolve(target[property](...args)).then(wrapCapability);
      },
      getPrototypeOf() { return RpcTarget.prototype; },
    });
  }
}
`;

/** Versioned Dynamic Worker harness combined with every immutable artifact. */
const CONTRACT_HARNESS_V6 = CONTRACT_HARNESS_V3
  .replace(
    'import { DurableObject, RpcTarget, restore } from "cloudflare:workers";',
    'import { DurableObject, RpcStub, RpcTarget, restore } from "cloudflare:workers";',
  )
  .replace(
    'export class ContractFacet extends DurableObject {',
    `${LIFECYCLE_MEMBRANE_V6}\nexport class ContractFacet extends DurableObject {`,
  )
  .replace('source: session.source.dup(),', 'source: wrapCapability(session.source.dup()),')
  .replace(
    '  createContext(session) {\n    const restore = (params) => {',
    '  createContext(session) {\n    const restorer = session.restorer.dup();\n' +
      '    const restore = (params) => {',
  )
  .replace('return session.restorer.restore(restorationId);',
    'return restorer.restore(restorationId);');

const MANUAL_APPROVAL_MEMBRANE_V7 = `
function createPolicy(approval) {
  return {
    approval: {
      manual(description, operation) {
        return approval.manual(description, async ({source}) =>
          wrapCapability(await operation({source: wrapCapability(source.dup())})));
      },
      require(description) {
        return approval.require(description);
      },
    },
  };
}
`;

/** Current Dynamic Worker harness, including Source and manual-approval lifetime membranes. */
export const CONTRACT_HARNESS = CONTRACT_HARNESS_V6
  .replace(
    'class LifecycleCapability extends RpcTarget {',
    `${MANUAL_APPROVAL_MEMBRANE_V7}\nclass LifecycleCapability extends RpcTarget {`,
  )
  .replace(
    'if (typeof property !== "string") return Reflect.get(_wrapper, property, _wrapper);',
    'if (property === Symbol.dispose) return () => target[Symbol.dispose]();\n' +
      '        if (typeof property !== "string") return Reflect.get(_wrapper, property, _wrapper);',
  )
  .replace(
    'policy: {approval: session.policy.approval.dup()},',
    'policy: createPolicy(session.policy.approval.dup()),',
  );

const DIRECT_APPROVAL_MEMBRANE_V8 = `
const INVOCATION_FIELDS = [
  "artifactHash", "authoritySnapshotDigest", "bindingId", "consumerId",
  "contractInstanceId", "generations", "invocationId", "methodName",
  "runtimeProfileHash", "schemaVersion", "startedAt",
];
const INVOCATION_GENERATION_FIELDS = [
  "authority", "binding", "consumer", "contractInstance", "environment",
];

function closedInvocationEvidence(invocation) {
  if (!invocation || typeof invocation !== "object" ||
      Object.keys(invocation).sort().join("\\0") !== INVOCATION_FIELDS.join("\\0")) {
    throw new TypeError("Contract invocation evidence has unknown or missing fields.");
  }
  const generationKeys = Object.keys(invocation.generations ?? {}).sort();
  if (generationKeys.join("\\0") !== INVOCATION_GENERATION_FIELDS.join("\\0")) {
    throw new TypeError("Contract invocation evidence has unknown or missing generations.");
  }
  const generations = Object.freeze(Object.fromEntries(
    INVOCATION_GENERATION_FIELDS.map((name) => [name, invocation.generations[name]])));
  return Object.freeze({
    schemaVersion: invocation.schemaVersion,
    invocationId: invocation.invocationId,
    consumerId: invocation.consumerId,
    bindingId: invocation.bindingId,
    contractInstanceId: invocation.contractInstanceId,
    artifactHash: invocation.artifactHash,
    runtimeProfileHash: invocation.runtimeProfileHash,
    methodName: invocation.methodName,
    startedAt: invocation.startedAt,
    authoritySnapshotDigest: invocation.authoritySnapshotDigest,
    generations,
  });
}

function createApproval(approval) {
  return {
    manual(description, operation) {
      return approval.manual(description, async ({source}) =>
        wrapCapability(await operation({source: wrapCapability(source.dup())})));
    },
    require(description) {
      return approval.require(description);
    },
  };
}
`;

/** Additive v8 harness with direct approval and closed invocation evidence. */
export const CONTRACT_HARNESS_V8 = CONTRACT_HARNESS
  .replace(MANUAL_APPROVAL_MEMBRANE_V7, DIRECT_APPROVAL_MEMBRANE_V8)
  .replace(
    'policy: createPolicy(session.policy.approval.dup()),',
    'approval: createApproval(session.approval.dup()),',
  )
  .replace('caller: session.caller,', 'invocation: closedInvocationEvidence(session.invocation),');

const CONTRACT_HARNESSES: Readonly<Record<string, string>> = {
  "1": CONTRACT_HARNESS_V1,
  "2": CONTRACT_HARNESS_V2,
  "3": CONTRACT_HARNESS_V3,
  "4": CONTRACT_HARNESS_V4,
  "5": CONTRACT_HARNESS_V5,
  "6": CONTRACT_HARNESS_V6,
  [CONTRACT_RUNTIME_HARNESS_VERSION]: CONTRACT_HARNESS,
  [CONTRACT_RUNTIME_HARNESS_V8_VERSION]: CONTRACT_HARNESS_V8,
};

/** Resolves the exact retained harness reviewed as part of an artifact's content hash. */
export function contractHarnessForVersion(version: string): string {
  const harness = CONTRACT_HARNESSES[version];
  if (!harness) throw new Error(`Unsupported Contract runtime harness version: ${version}`);
  return harness;
}
