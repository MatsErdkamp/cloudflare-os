import {env, RpcStub, RpcTarget} from "cloudflare:workers";
import {describe, expect, it} from "vitest";
import type {
  ProviderActionEvidence,
  ProviderActionStager,
  ProviderAuthorityIdentity,
  ProviderAuthorityLifecycleRequest,
  ProviderObservationEnforcer,
  ProviderObservationEvidence,
} from "@gadgets/workshop-shared/gatekeeper-authority";

import {R2Authority} from "../src/r2-authority.js";
import type {R2AccountState} from "../src/r2.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_R2_AUTHORITY: DurableObjectNamespace<R2Authority>;
    TEST_R2_ACCOUNT_STATE: DurableObjectNamespace<R2AccountState>;
    STORAGE: R2Bucket;
  }
}

class RecordingObservationEnforcer extends RpcTarget implements ProviderObservationEnforcer {
  readonly evidence: ProviderObservationEvidence[] = [];
  reject = false;

  async authorizeProviderObservation(evidence: ProviderObservationEvidence): Promise<void> {
    if (this.reject) throw new Error("observation refused");
    this.evidence.push(evidence);
  }
}

class RecordingActionStager extends RpcTarget implements ProviderActionStager {
  readonly evidence: ProviderActionEvidence[] = [];
  reject = false;

  async stageProviderAction(evidence: ProviderActionEvidence): Promise<void> {
    if (this.reject) throw new Error("action refused");
    this.evidence.push(evidence);
  }
}

class BlockingObservationEnforcer extends RpcTarget implements ProviderObservationEnforcer {
  readonly entered: Promise<void>;
  #enter!: () => void;
  #release!: () => void;
  #barrier: Promise<void>;

  constructor() {
    super();
    this.entered = new Promise(resolve => {
      this.#enter = resolve;
    });
    this.#barrier = new Promise(resolve => {
      this.#release = resolve;
    });
  }

  async authorizeProviderObservation(): Promise<void> {
    this.#enter();
    await this.#barrier;
  }

  release(): void {
    this.#release();
  }
}

function lifecycleRequest(
  identity: ProviderAuthorityIdentity,
  operationId: string,
  expectedCapabilityGeneration: number,
): ProviderAuthorityLifecycleRequest {
  return {
    operationId,
    expectedProvider: identity,
    contractInstance: {id: "contract-instance-1", generation: 1},
    expectedCapabilityGeneration,
  };
}

async function prepareAndActivate(name: string) {
  const authority = env.TEST_R2_AUTHORITY.getByName(name);
  const description = await authority.describeProviderAuthority();
  const prepared = await authority.prepareProviderAuthority(
    lifecycleRequest(description.identity, "prepare-1", 0),
  );
  const replayed = await authority.prepareProviderAuthority(
    lifecycleRequest(description.identity, "prepare-1", 0),
  );
  expect(replayed).toEqual(prepared);
  const active = await authority.activateProviderAuthority(
    lifecycleRequest(description.identity, "activate-1", 1),
  );
  return {
    authority,
    description,
    active,
    accountId: env.TEST_R2_AUTHORITY.idFromName(name).toString(),
  };
}

async function rejectionOf<T>(promise: PromiseLike<T>): Promise<Error> {
  return promise.then(
    () => new Error("Expected the RPC call to reject."),
    error => error instanceof Error ? error : new Error(String(error)),
  );
}

describe.sequential("R2 provider authority", () => {
  it("exposes only the closed provider-authority protocol", () => {
    expect(Object.getOwnPropertyNames(R2Authority.prototype).toSorted()).toEqual([
      "activateProviderAuthority",
      "applyProviderAction",
      "constructor",
      "deactivateProviderAuthority",
      "describeProviderAuthority",
      "destroyProviderAuthority",
      "prepareProviderAuthority",
      "rejectProviderAction",
      "startProviderAuthoritySession",
    ]);
  });

  it("keeps identity stable and lifecycle operations idempotent", async () => {
    const authority = env.TEST_R2_AUTHORITY.getByName("identity-lifecycle");
    const first = await authority.describeProviderAuthority();
    const second = await env.TEST_R2_AUTHORITY.getByName("identity-lifecycle")
      .describeProviderAuthority();
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      health: "healthy",
      providerNativeScope: {
        resources: ["deployment-r2-bucket"],
        operations: ["head", "get", "list", "put", "delete"],
      },
      providerNativeRevocationGranularity: "deployment-resource",
      localEnforcementRevocationGranularity: "contract-instance-backing",
    });
    expect(JSON.stringify(first)).not.toContain("provider-authority/");
    expect(JSON.stringify(first)).not.toContain("accounts/");

    const request = lifecycleRequest(first.identity, "prepare-stable", 0);
    const prepared = await authority.prepareProviderAuthority(request);
    expect(await authority.prepareProviderAuthority(request)).toEqual(prepared);
    expect((await rejectionOf(authority.prepareProviderAuthority({
      ...request,
      contractInstance: {id: "different-instance", generation: 1},
    }))).message).toContain("reused for a different request");
  });

  it("separates structured observation enforcement from action staging", async () => {
    const {authority, description, active} = await prepareAndActivate("evidence");
    const observations = new RecordingObservationEnforcer();
    const actions = new RecordingActionStager();
    const session = await authority.startProviderAuthoritySession(
      {
        expectedProvider: description.identity,
        contractInstance: active.contractInstance,
        expectedCapabilityGeneration: active.capabilityGeneration,
      },
      new RpcStub(observations),
      new RpcStub(actions),
    );
    try {
      await session.put("reports/summary.txt", "hello");
      expect(observations.evidence).toHaveLength(0);
      expect(actions.evidence).toHaveLength(1);
      expect(actions.evidence[0]).toMatchObject({
        provider: description.identity,
        contractInstance: active.contractInstance,
        capabilityGeneration: 1,
        operation: "put",
        resource: "logical:reports/summary.txt",
        bytes: 5,
      });
      expect(Object.keys(actions.evidence[0]!)).not.toEqual(
        expect.arrayContaining(["consumer", "task", "environment", "ratchet", "invocationId"]),
      );

      const applyRequest = {
        operationId: "apply-report",
        expectedProvider: description.identity,
        contractInstance: active.contractInstance,
        expectedCapabilityGeneration: 1,
        actionId: actions.evidence[0]!.actionId,
      } as const;
      await authority.applyProviderAction(applyRequest);
      await authority.applyProviderAction(applyRequest);
      const object = await session.get("reports/summary.txt");
      expect(new TextDecoder().decode(object?.body)).toBe("hello");
      expect(observations.evidence).toHaveLength(1);
      expect(observations.evidence[0]).toMatchObject({
        operation: "get",
        classification: "content",
        provenance: "provider-live",
        bytes: 5,
      });
      expect(Object.keys(observations.evidence[0]!)).not.toEqual(
        expect.arrayContaining(["consumer", "task", "environment", "ratchet", "invocationId"]),
      );
    } finally {
      session[Symbol.dispose]();
    }
  });

  it("invalidates stale sessions and staged-action callbacks before cleanup", async () => {
    const name = "invalidation";
    const {authority, description, active, accountId} = await prepareAndActivate(name);
    const observations = new RecordingObservationEnforcer();
    const actions = new RecordingActionStager();
    const session = await authority.startProviderAuthoritySession(
      {
        expectedProvider: description.identity,
        contractInstance: active.contractInstance,
        expectedCapabilityGeneration: 1,
      },
      new RpcStub(observations),
      new RpcStub(actions),
    );
    await session.put("retained.txt", "account-owned");
    await authority.applyProviderAction({
      operationId: "apply-retained",
      expectedProvider: description.identity,
      contractInstance: active.contractInstance,
      expectedCapabilityGeneration: 1,
      actionId: actions.evidence[0]!.actionId,
    });
    await session.put("pending.txt", "pending");
    const actionId = actions.evidence[1]!.actionId;
    const providerObjectsBeforeDestroy = await env.STORAGE.list({prefix: "provider-authority/"});
    expect(providerObjectsBeforeDestroy.objects.length).toBeGreaterThan(0);

    const inactive = await authority.deactivateProviderAuthority(
      lifecycleRequest(description.identity, "deactivate-1", 1),
    );
    expect(inactive).toMatchObject({state: "inactive", capabilityGeneration: 2});
    expect((await rejectionOf(session.head("pending.txt"))).message).toContain("not active");
    expect((await rejectionOf(authority.applyProviderAction({
      operationId: "stale-apply",
      expectedProvider: description.identity,
      contractInstance: active.contractInstance,
      expectedCapabilityGeneration: 1,
      actionId,
    }))).message).toContain("not active");

    const destroyed = await authority.destroyProviderAuthority(
      lifecycleRequest(description.identity, "destroy-1", 2),
    );
    expect(destroyed).toMatchObject({
      state: "destroyed",
      capabilityGeneration: 3,
      cleanup: "complete",
    });
    expect(await authority.destroyProviderAuthority(
      lifecycleRequest(description.identity, "destroy-1", 2),
    )).toEqual(destroyed);
    const providerObjectsAfterDestroy = await env.STORAGE.list({prefix: "provider-authority/"});
    expect(providerObjectsAfterDestroy.objects.length).toBeLessThan(
      providerObjectsBeforeDestroy.objects.length,
    );
    expect(await env.STORAGE.get(`accounts/${accountId}/objects/retained.txt`)).not.toBeNull();
    session[Symbol.dispose]();
  });

  it("rejects provider and generation mismatches and withholds refused observations", async () => {
    const {authority, description, active} = await prepareAndActivate("mismatch");
    const observations = new RecordingObservationEnforcer();
    observations.reject = true;
    const actions = new RecordingActionStager();
    expect((await rejectionOf(authority.startProviderAuthoritySession(
      {
        expectedProvider: {...description.identity, sourceGeneration: 2},
        contractInstance: active.contractInstance,
        expectedCapabilityGeneration: 1,
      },
      new RpcStub(observations),
      new RpcStub(actions),
    ))).message).toContain("identity or Source generation mismatch");

    const session = await authority.startProviderAuthoritySession(
      {
        expectedProvider: description.identity,
        contractInstance: active.contractInstance,
        expectedCapabilityGeneration: 1,
      },
      new RpcStub(observations),
      new RpcStub(actions),
    );
    try {
      expect((await rejectionOf(session.get("missing.txt"))).message).toContain("observation refused");
      expect(observations.evidence).toHaveLength(0);
    } finally {
      session[Symbol.dispose]();
    }
  });

  it("withholds a result when its generation changes during host enforcement", async () => {
    const name = "observation-race";
    const {authority, description, active, accountId} = await prepareAndActivate(name);
    await env.STORAGE.put(`accounts/${accountId}/objects/result.txt`, "protected");
    const observations = new BlockingObservationEnforcer();
    const actions = new RecordingActionStager();
    const session = await authority.startProviderAuthoritySession(
      {
        expectedProvider: description.identity,
        contractInstance: active.contractInstance,
        expectedCapabilityGeneration: active.capabilityGeneration,
      },
      new RpcStub(observations),
      new RpcStub(actions),
    );
    const pending = session.get("result.txt");
    await observations.entered;
    await authority.deactivateProviderAuthority(
      lifecycleRequest(description.identity, "deactivate-race", 1),
    );
    observations.release();
    expect((await rejectionOf(pending)).message).toContain("not active");
    session[Symbol.dispose]();
  });

  it("reconciles an accepted account mutation by operation receipt after revocation", async () => {
    const namespace = env.TEST_R2_ACCOUNT_STATE;
    const id = namespace.idFromName("account-mutation-receipt");
    const account = namespace.get(id);
    const request = {
      operationId: "account-put-1",
      fingerprint: "put:receipt.txt:content-1",
      type: "put" as const,
      key: "receipt.txt",
      body: new TextEncoder().encode("recorded"),
    };
    expect(await account.applyAuthorityObjectMutation(request)).toBe("applied");
    await account.revoke();
    expect(await account.applyAuthorityObjectMutation(request)).toBe("applied");
    expect((await rejectionOf(account.applyAuthorityObjectMutation({
      ...request,
      fingerprint: "different",
    }))).message).toContain("reused for a different provider mutation");
    expect(await account.applyAuthorityObjectMutation({
      ...request,
      operationId: "account-put-after-revoke",
      fingerprint: "put:receipt.txt:content-2",
    })).toBe("rejected-revoked");
    const stored = await env.STORAGE.get(`accounts/${id.toString()}/objects/receipt.txt`);
    expect(await stored?.text()).toBe("recorded");
  });
});
