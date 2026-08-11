import {DurableObject, RpcStub, RpcTarget} from "cloudflare:workers";
import {validateRpc} from "capnweb-validate";
import type {
  GatekeeperAuthorityProvider,
  ProviderActionCallbackRequest,
  ProviderActionEvidence,
  ProviderActionStager,
  ProviderAuthorityDescription,
  ProviderAuthorityIdentity,
  ProviderAuthorityLifecycleRequest,
  ProviderAuthorityLifecycleResult,
  ProviderAuthoritySessionRequest,
  ProviderNativeAuthorityScope,
  ProviderObservationEnforcer,
  ProviderObservationEvidence,
} from "@gadgets/workshop-shared/gatekeeper-authority";
import type {
  R2BucketSession,
  R2HttpMetadata,
  R2ListOptions,
  R2ObjectPage,
  R2PutOptions as PublicR2PutOptions,
  R2StoredObject,
  R2StoredObjectBody,
} from "./types.js";

const PROVIDER_ID = "cloudflare-r2";
const MAX_KEY_BYTES = 1024;
const MAX_OBJECT_BYTES = 1024 * 1024;
const MAX_OPERATION_ID_BYTES = 256;
const PROVIDER_NATIVE_SCOPE: ProviderNativeAuthorityScope = {
  resources: ["deployment-r2-bucket"],
  operations: ["head", "get", "list", "put", "delete"],
  recipients: [],
  egress: [],
};

type Env = Cloudflare.Env;
type AuthorityProps = {accountId?: string};
type AuthorityState = {
  contractInstance: ProviderAuthorityLifecycleResult["contractInstance"];
  backingReference: string;
  storageNonce: string;
  capabilityGeneration: number;
  state: ProviderAuthorityLifecycleResult["state"];
  cleanup: ProviderAuthorityLifecycleResult["cleanup"];
  pendingDestroyOperationId?: string;
};
type OperationRecord = {
  fingerprint: string;
  result?: ProviderAuthorityLifecycleResult;
  cleanupKey?: string;
};
type StagedAction = {
  actionId: string;
  contractInstance: ProviderAuthorityLifecycleResult["contractInstance"];
  capabilityGeneration: number;
  type: "put" | "delete";
  key: string;
  stagingKey?: string;
  applyOperationId?: string;
  applyFingerprint?: string;
};
type AuthoritySessionDriver = {
  validate(request: ProviderAuthoritySessionRequest): Promise<void>;
  readHead(request: ProviderAuthoritySessionRequest, key: string): Promise<R2StoredObject | null>;
  readObject(
    request: ProviderAuthoritySessionRequest,
    key: string,
  ): Promise<R2StoredObjectBody | null>;
  readList(
    request: ProviderAuthoritySessionRequest,
    options: ReturnType<typeof normalizeListOptions>,
  ): Promise<R2ObjectPage>;
  stagePut(
    request: ProviderAuthoritySessionRequest,
    key: string,
    body: Uint8Array | string,
    options?: PublicR2PutOptions,
  ): Promise<{object: R2StoredObject; evidence: ProviderActionEvidence}>;
  stageDelete(
    request: ProviderAuthoritySessionRequest,
    key: string,
  ): Promise<ProviderActionEvidence>;
  discardAction(request: ProviderAuthoritySessionRequest, actionId: string): Promise<void>;
  observationEvidence(
    request: ProviderAuthoritySessionRequest,
    operation: string,
    resource: string,
    bytes: number,
    classification: ProviderObservationEvidence["classification"],
    provenance: ProviderObservationEvidence["provenance"],
  ): Promise<ProviderObservationEvidence>;
};

function assertBoundedId(value: string, label: string): void {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes === 0 || bytes > MAX_OPERATION_ID_BYTES) {
    throw new TypeError(`${label} must contain 1 through ${MAX_OPERATION_ID_BYTES} bytes.`);
  }
}

function assertLogicalKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("R2 object keys must be non-empty strings.");
  }
  if (key.startsWith(".gatekeeper/")) {
    throw new TypeError("R2 object keys cannot begin with .gatekeeper/.");
  }
  if (/\p{Cc}/u.test(key)) throw new TypeError("R2 object keys cannot contain control characters.");
  if (new TextEncoder().encode(key).byteLength > MAX_KEY_BYTES) {
    throw new RangeError(`R2 object keys cannot exceed ${MAX_KEY_BYTES} UTF-8 bytes.`);
  }
}

function normalizeListOptions(options: R2ListOptions = {}): Required<Pick<
  R2ListOptions,
  "prefix" | "limit"
>> & Pick<R2ListOptions, "cursor" | "delimiter"> {
  const prefix = options.prefix ?? "";
  if (/\p{Cc}/u.test(prefix) || prefix.startsWith(".gatekeeper/")) {
    throw new TypeError("Invalid R2 list prefix.");
  }
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("R2 list limit must be an integer from 1 through 1000.");
  }
  return {prefix, limit, cursor: options.cursor, delimiter: options.delimiter};
}

function publicHttpMetadata(metadata?: R2HTTPMetadata): R2HttpMetadata | undefined {
  if (!metadata) return undefined;
  return {
    contentType: metadata.contentType,
    contentDisposition: metadata.contentDisposition,
    cacheControl: metadata.cacheControl,
    contentEncoding: metadata.contentEncoding,
    contentLanguage: metadata.contentLanguage,
  };
}

function publicObject(object: R2Object, key: string): R2StoredObject {
  return {
    key,
    size: object.size,
    etag: object.etag,
    uploaded: object.uploaded,
    httpMetadata: publicHttpMetadata(object.httpMetadata),
    customMetadata: object.customMetadata,
  };
}

async function publicObjectBody(object: R2ObjectBody, key: string): Promise<R2StoredObjectBody> {
  if (object.size > MAX_OBJECT_BYTES) {
    await object.body.cancel("R2 object exceeds the bounded Source result limit.");
    throw new RangeError(`R2 objects cannot exceed ${MAX_OBJECT_BYTES} bytes.`);
  }
  return {...publicObject(object, key), body: new Uint8Array(await object.arrayBuffer())};
}

function toNativePutOptions(options?: PublicR2PutOptions): R2PutOptions | undefined {
  return options
    ? {httpMetadata: options.httpMetadata, customMetadata: options.customMetadata}
    : undefined;
}

function scope(operation: string, resource: string): ProviderNativeAuthorityScope {
  return {resources: [resource], operations: [operation], recipients: [], egress: []};
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

@validateRpc()
class R2ProviderAuthoritySession extends RpcTarget implements R2BucketSession {
  constructor(
    private readonly driver: AuthoritySessionDriver,
    private readonly request: ProviderAuthoritySessionRequest,
    private readonly observationEnforcer: RpcStub<ProviderObservationEnforcer>,
    private readonly actionStager: RpcStub<ProviderActionStager>,
  ) {
    super();
  }

  async head(key: string): Promise<R2StoredObject | null> {
    assertLogicalKey(key);
    const object = await this.driver.readHead(this.request, key);
    await this.#authorizeObservation("head", key, object?.size ?? 0, "metadata",
      object ? "provider-live" : "provider-missing");
    await this.driver.validate(this.request);
    return object;
  }

  async get(key: string): Promise<R2StoredObjectBody | null> {
    assertLogicalKey(key);
    const object = await this.driver.readObject(this.request, key);
    await this.#authorizeObservation("get", key, object?.size ?? 0, "content",
      object ? "provider-live" : "provider-missing");
    await this.driver.validate(this.request);
    return object;
  }

  async list(options?: R2ListOptions): Promise<R2ObjectPage> {
    const normalized = normalizeListOptions(options);
    const page = await this.driver.readList(this.request, normalized);
    await this.#authorizeObservation("list", normalized.prefix || "root", 0, "listing", "provider-live");
    await this.driver.validate(this.request);
    return page;
  }

  async put(
    key: string,
    body: Uint8Array | string,
    options?: PublicR2PutOptions,
  ): Promise<R2StoredObject> {
    assertLogicalKey(key);
    const staged = await this.driver.stagePut(this.request, key, body, options);
    try {
      await this.actionStager.stageProviderAction(staged.evidence);
      await this.driver.validate(this.request);
      return staged.object;
    } catch (error) {
      await this.driver.discardAction(this.request, staged.evidence.actionId);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertLogicalKey(key);
    const evidence = await this.driver.stageDelete(this.request, key);
    try {
      await this.actionStager.stageProviderAction(evidence);
      await this.driver.validate(this.request);
    } catch (error) {
      await this.driver.discardAction(this.request, evidence.actionId);
      throw error;
    }
  }

  async #authorizeObservation(
    operation: string,
    resource: string,
    bytes: number,
    classification: ProviderObservationEvidence["classification"],
    provenance: ProviderObservationEvidence["provenance"],
  ): Promise<void> {
    const evidence = await this.driver.observationEvidence(
      this.request,
      operation,
      resource,
      bytes,
      classification,
      provenance,
    );
    await this.observationEnforcer.authorizeProviderObservation(evidence);
  }

  [Symbol.dispose](): void {
    this.observationEnforcer[Symbol.dispose]();
    this.actionStager[Symbol.dispose]();
  }
}

/** Account-imbued task-neutral R2 provider authority and generation-enforcement facet. */
@validateRpc()
export class R2Authority extends DurableObject<Env, AuthorityProps>
    implements GatekeeperAuthorityProvider<R2BucketSession> {
  async describeProviderAuthority(): Promise<ProviderAuthorityDescription> {
    const identity = await this.#identity();
    return {
      identity,
      health: await this.#accountHealth(),
      providerNativeScope: PROVIDER_NATIVE_SCOPE,
      providerNativeRevocationGranularity: "deployment-resource",
      localEnforcementRevocationGranularity: "contract-instance-backing",
    };
  }

  async prepareProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult> {
    await this.#assertAccountActive();
    return this.#runLifecycle("prepare", request, current => {
      if (current) throw new Error("Provider backing is already prepared for this Contract Instance.");
      if (request.expectedCapabilityGeneration !== 0) {
        throw new Error("First provider preparation requires capability generation zero.");
      }
      return {
        contractInstance: structuredClone(request.contractInstance),
        backingReference: crypto.randomUUID(),
        storageNonce: crypto.randomUUID(),
        capabilityGeneration: 1,
        state: "prepared",
        cleanup: "not-required",
      };
    });
  }

  async activateProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult> {
    await this.#assertAccountActive();
    return this.#runLifecycle("activate", request, current => {
      if (!current || (current.state !== "prepared" && current.state !== "inactive")) {
        throw new Error("Provider backing is not prepared or inactive.");
      }
      return {...current, state: "active", cleanup: "not-required"};
    });
  }

  async deactivateProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult> {
    return this.#runLifecycle("deactivate", request, current => {
      if (!current || current.state !== "active") throw new Error("Provider backing is not active.");
      return {
        ...current,
        state: "inactive",
        capabilityGeneration: current.capabilityGeneration + 1,
      };
    });
  }

  async destroyProviderAuthority(
    request: ProviderAuthorityLifecycleRequest,
  ): Promise<ProviderAuthorityLifecycleResult> {
    await this.#validateRequest(request);
    const fingerprint = this.#operationFingerprint("destroy", request);
    const replay = this.#replayOperation(request.operationId, fingerprint);
    if (replay?.result) return replay.result;
    const key = this.#authorityKey(request.contractInstance.id);
    let current = this.ctx.storage.kv.get<AuthorityState>(key);
    if (!current) throw new Error("No provider backing exists for this Contract Instance.");
    this.#assertNoApplyingAction(request.contractInstance.id);
    if (current.state !== "destroyed") {
      this.#assertLifecycleExpectation(current, request);
      current = {
        ...current,
        state: "destroyed",
        capabilityGeneration: current.capabilityGeneration + 1,
        cleanup: "pending",
        pendingDestroyOperationId: request.operationId,
      };
      this.ctx.storage.kv.put(key, current);
    } else if (current.pendingDestroyOperationId !== request.operationId) {
      throw new Error("Provider backing destruction is owned by another Authority Operation.");
    }
    await this.#cleanupBacking(current);
    const complete: AuthorityState = {
      ...current,
      cleanup: "complete",
      pendingDestroyOperationId: undefined,
    };
    const result = this.#lifecycleResult(complete);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.put(key, complete);
      this.ctx.storage.kv.put(this.#operationKey(request.operationId), {fingerprint, result});
      for (const [actionKey, action] of this.ctx.storage.kv.list<StagedAction>({prefix: "action:"})) {
        if (action.contractInstance.id === request.contractInstance.id) {
          this.ctx.storage.kv.delete(actionKey);
        }
      }
    });
    return result;
  }

  async startProviderAuthoritySession(
    request: ProviderAuthoritySessionRequest,
    observationEnforcer: RpcStub<ProviderObservationEnforcer>,
    actionStager: RpcStub<ProviderActionStager>,
  ): Promise<R2BucketSession> {
    await this.#assertAccountActive();
    await this.#requireActive(request);
    return new R2ProviderAuthoritySession(
      {
        validate: async sessionRequest => {
          await this.#requireActive(sessionRequest);
        },
        readHead: (sessionRequest, key) => this.#readHead(sessionRequest, key),
        readObject: (sessionRequest, key) => this.#readObject(sessionRequest, key),
        readList: (sessionRequest, options) => this.#readList(sessionRequest, options),
        stagePut: (sessionRequest, key, body, options) =>
          this.#stagePut(sessionRequest, key, body, options),
        stageDelete: (sessionRequest, key) => this.#stageDelete(sessionRequest, key),
        discardAction: (sessionRequest, actionId) =>
          this.#discardUnregisteredAction(sessionRequest, actionId),
        observationEvidence: (sessionRequest, operation, resource, bytes,
          classification, provenance) => this.#observationEvidence(
          sessionRequest,
          operation,
          resource,
          bytes,
          classification,
          provenance,
        ),
      },
      structuredClone(request),
      observationEnforcer.dup(),
      actionStager.dup(),
    );
  }

  async applyProviderAction(request: ProviderActionCallbackRequest): Promise<void> {
    await this.#runExclusively(() => this.#completeAction("apply", request));
  }

  async rejectProviderAction(request: ProviderActionCallbackRequest): Promise<void> {
    await this.#runExclusively(() => this.#completeAction("reject", request));
  }

  async #readHead(
    request: ProviderAuthoritySessionRequest,
    key: string,
  ): Promise<R2StoredObject | null> {
    await this.#requireActive(request);
    const object = await this.env.STORAGE.head(this.#objectKey(key));
    await this.#requireActive(request);
    return object ? publicObject(object, key) : null;
  }

  async #readObject(
    request: ProviderAuthoritySessionRequest,
    key: string,
  ): Promise<R2StoredObjectBody | null> {
    await this.#requireActive(request);
    const object = await this.env.STORAGE.get(this.#objectKey(key));
    await this.#requireActive(request);
    return object ? await publicObjectBody(object, key) : null;
  }

  async #readList(
    request: ProviderAuthoritySessionRequest,
    options: ReturnType<typeof normalizeListOptions>,
  ): Promise<R2ObjectPage> {
    await this.#requireActive(request);
    const prefix = this.#objectsPrefix();
    const listed = await this.env.STORAGE.list({
      prefix: prefix + options.prefix,
      limit: options.limit,
      cursor: options.cursor,
      delimiter: options.delimiter,
      include: ["httpMetadata", "customMetadata"],
    });
    await this.#requireActive(request);
    return {
      objects: listed.objects.map(object => publicObject(object, object.key.slice(prefix.length))),
      delimitedPrefixes: listed.delimitedPrefixes.map(value => value.slice(prefix.length)).toSorted(),
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : undefined,
    };
  }

  async #stagePut(
    request: ProviderAuthoritySessionRequest,
    key: string,
    body: Uint8Array | string,
    options?: PublicR2PutOptions,
  ): Promise<{object: R2StoredObject; evidence: ProviderActionEvidence}> {
    const authority = await this.#requireActive(request);
    const bytes = typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength;
    if (bytes > MAX_OBJECT_BYTES) throw new RangeError(`R2 objects cannot exceed ${MAX_OBJECT_BYTES} bytes.`);
    const actionId = crypto.randomUUID();
    const stagingKey = this.#stagingKey(authority, actionId);
    const object = await this.env.STORAGE.put(stagingKey, body, toNativePutOptions(options));
    await this.#requireActive(request);
    const action: StagedAction = {
      actionId,
      contractInstance: structuredClone(request.contractInstance),
      capabilityGeneration: request.expectedCapabilityGeneration,
      type: "put",
      key,
      stagingKey,
    };
    this.ctx.storage.kv.put(this.#actionKey(actionId), action);
    return {
      object: publicObject(object, key),
      evidence: await this.#actionEvidence(request, action, bytes),
    };
  }

  async #stageDelete(
    request: ProviderAuthoritySessionRequest,
    key: string,
  ): Promise<ProviderActionEvidence> {
    await this.#requireActive(request);
    const action: StagedAction = {
      actionId: crypto.randomUUID(),
      contractInstance: structuredClone(request.contractInstance),
      capabilityGeneration: request.expectedCapabilityGeneration,
      type: "delete",
      key,
    };
    this.ctx.storage.kv.put(this.#actionKey(action.actionId), action);
    return this.#actionEvidence(request, action, 0);
  }

  async #discardUnregisteredAction(
    request: ProviderAuthoritySessionRequest,
    actionId: string,
  ): Promise<void> {
    const action = this.ctx.storage.kv.get<StagedAction>(this.#actionKey(actionId));
    if (!action || !sameValue(action.contractInstance, request.contractInstance)) return;
    if (action.stagingKey) await this.env.STORAGE.delete(action.stagingKey);
    this.ctx.storage.kv.delete(this.#actionKey(actionId));
  }

  async #observationEvidence(
    request: ProviderAuthoritySessionRequest,
    operation: string,
    resource: string,
    bytes: number,
    classification: ProviderObservationEvidence["classification"],
    provenance: ProviderObservationEvidence["provenance"],
  ): Promise<ProviderObservationEvidence> {
    await this.#requireActive(request);
    const selectedScope = scope(operation, `logical:${resource}`);
    return {
      observationId: crypto.randomUUID(),
      provider: await this.#identity(),
      contractInstance: structuredClone(request.contractInstance),
      capabilityGeneration: request.expectedCapabilityGeneration,
      operation,
      resource: `logical:${resource}`,
      requestedScope: selectedScope,
      resolvedScope: selectedScope,
      returnedScope: provenance === "provider-missing"
        ? {...selectedScope, resources: []}
        : selectedScope,
      classification,
      provenance,
      bytes,
    };
  }

  async #actionEvidence(
    request: ProviderAuthoritySessionRequest,
    action: StagedAction,
    bytes: number,
  ): Promise<ProviderActionEvidence> {
    await this.#requireActive(request);
    const selectedScope = scope(action.type, `logical:${action.key}`);
    return {
      actionId: action.actionId,
      provider: await this.#identity(),
      contractInstance: structuredClone(request.contractInstance),
      capabilityGeneration: request.expectedCapabilityGeneration,
      operation: action.type,
      resource: `logical:${action.key}`,
      requestedScope: selectedScope,
      resolvedScope: selectedScope,
      bytes,
    };
  }

  async #completeAction(
    kind: "apply" | "reject",
    request: ProviderActionCallbackRequest,
  ): Promise<void> {
    assertBoundedId(request.operationId, "Authority Operation ID");
    assertBoundedId(request.actionId, "Provider action ID");
    await this.#assertExpectedProvider(request.expectedProvider);
    const fingerprint = this.#operationFingerprint(kind, request);
    const replay = this.#replayOperation(request.operationId, fingerprint);
    if (replay) {
      if (replay.cleanupKey) await this.env.STORAGE.delete(replay.cleanupKey);
      return;
    }
    const sessionRequest: ProviderAuthoritySessionRequest = {
      expectedProvider: request.expectedProvider,
      contractInstance: request.contractInstance,
      expectedCapabilityGeneration: request.expectedCapabilityGeneration,
    };
    const authority = this.#requireLocallyActive(sessionRequest);
    let action = this.ctx.storage.kv.get<StagedAction>(this.#actionKey(request.actionId));
    if (!action || !sameValue(action.contractInstance, request.contractInstance) ||
        action.capabilityGeneration !== request.expectedCapabilityGeneration) {
      throw new Error("Provider action does not belong to the expected authority generation.");
    }
    if (kind === "reject" && action.applyOperationId) {
      throw new Error("Provider action application must reconcile before rejection.");
    }
    if (kind === "apply") {
      if (action.applyOperationId &&
          (action.applyOperationId !== request.operationId || action.applyFingerprint !== fingerprint)) {
        throw new Error("Provider action application is owned by another Authority Operation.");
      }
      action = {...action, applyOperationId: request.operationId, applyFingerprint: fingerprint};
      this.ctx.storage.kv.put(this.#actionKey(request.actionId), action);
      const outcome = await this.#applyProviderMutation(action, request.operationId, fingerprint);
      if (outcome === "rejected-revoked") {
        this.ctx.storage.kv.put(this.#actionKey(request.actionId), {
          ...action,
          applyOperationId: undefined,
          applyFingerprint: undefined,
        });
        throw new Error("This R2 storage account has been revoked.");
      }
    }
    this.#assertLifecycleExpectation(authority, sessionRequest);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.delete(this.#actionKey(request.actionId));
      this.ctx.storage.kv.put(this.#operationKey(request.operationId), {
        fingerprint,
        cleanupKey: action.stagingKey,
      });
    });
    if (action.stagingKey) await this.env.STORAGE.delete(action.stagingKey);
  }

  async #applyProviderMutation(
    action: StagedAction,
    operationId: string,
    fingerprint: string,
  ): Promise<"applied" | "rejected-revoked"> {
    let body: Uint8Array | undefined;
    let options: PublicR2PutOptions | undefined;
    if (action.type === "put") {
      const staged = await this.env.STORAGE.get(action.stagingKey!);
      if (!staged) throw new Error("Staged R2 provider action body is missing.");
      body = new Uint8Array(await staged.arrayBuffer());
      options = {
        httpMetadata: publicHttpMetadata(staged.httpMetadata),
        customMetadata: staged.customMetadata,
      };
    }
    if (this.ctx.props.accountId) {
      const namespace = this.ctx.exports.R2AccountState;
      return namespace.get(namespace.idFromString(this.ctx.props.accountId))
        .applyAuthorityObjectMutation({
          operationId,
          fingerprint,
          type: action.type,
          key: action.key,
          body,
          options,
        });
    }
    if (action.type === "delete") {
      await this.env.STORAGE.delete(this.#objectKey(action.key));
    } else {
      await this.env.STORAGE.put(this.#objectKey(action.key), body!, toNativePutOptions(options));
    }
    return "applied";
  }

  async #runExclusively(operation: () => Promise<void>): Promise<void> {
    let failure: unknown;
    await this.ctx.blockConcurrencyWhile(async () => {
      try {
        await operation();
      } catch (error) {
        failure = error;
      }
    });
    if (failure !== undefined) throw failure;
  }

  async #identity(): Promise<ProviderAuthorityIdentity> {
    // Provider lifecycle facets are deliberately per-Contract Instance.  Their identity must
    // nevertheless describe the account-owned Source rather than the individual facet, otherwise
    // a description obtained before an Instance exists could never authorize the Instance facet.
    const accountId = this.ctx.props.accountId ?? this.ctx.id.toString();
    return {
      providerId: PROVIDER_ID,
      accountId,
      sourceId: `r2-account:${accountId}`,
      sourceGeneration: this.ctx.storage.kv.get<number>("provider:sourceGeneration") ?? 1,
    };
  }

  async #assertAccountActive(): Promise<void> {
    // Direct namespace bindings used by workerd conformance do not carry entrypoint props.
    if (!this.ctx.props.accountId) return;
    const namespace = this.ctx.exports.R2AccountState;
    await namespace.get(namespace.idFromString(this.#accountId())).assertActive();
  }

  async #accountHealth(): Promise<"healthy" | "revoked"> {
    if (!this.ctx.props.accountId) return "healthy";
    const namespace = this.ctx.exports.R2AccountState;
    return namespace.get(namespace.idFromString(this.#accountId())).authorityHealth();
  }

  async #runLifecycle(
    kind: "prepare" | "activate" | "deactivate",
    request: ProviderAuthorityLifecycleRequest,
    transition: (current: AuthorityState | undefined) => AuthorityState,
  ): Promise<ProviderAuthorityLifecycleResult> {
    await this.#validateRequest(request);
    const fingerprint = this.#operationFingerprint(kind, request);
    const replay = this.#replayOperation(request.operationId, fingerprint);
    if (replay?.result) return replay.result;
    const key = this.#authorityKey(request.contractInstance.id);
    const current = this.ctx.storage.kv.get<AuthorityState>(key);
    if (current) this.#assertLifecycleExpectation(current, request);
    if (kind === "deactivate") this.#assertNoApplyingAction(request.contractInstance.id);
    const next = transition(current);
    const result = this.#lifecycleResult(next);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.put(key, next);
      this.ctx.storage.kv.put(this.#operationKey(request.operationId), {fingerprint, result});
    });
    return result;
  }

  async #validateRequest(request: ProviderAuthorityLifecycleRequest): Promise<void> {
    assertBoundedId(request.operationId, "Authority Operation ID");
    assertBoundedId(request.contractInstance.id, "Contract Instance ID");
    if (!Number.isSafeInteger(request.contractInstance.generation) ||
        request.contractInstance.generation < 1 ||
        !Number.isSafeInteger(request.expectedCapabilityGeneration) ||
        request.expectedCapabilityGeneration < 0) {
      throw new TypeError("Authority generations must be non-negative safe integers.");
    }
    await this.#assertExpectedProvider(request.expectedProvider);
  }

  async #assertExpectedProvider(expected: ProviderAuthorityIdentity): Promise<void> {
    const actual = await this.#identity();
    if (!sameValue(actual, expected)) throw new Error("Provider identity or Source generation mismatch.");
  }

  #assertLifecycleExpectation(
    current: AuthorityState,
    request: Pick<ProviderAuthorityLifecycleRequest, "contractInstance" |
      "expectedCapabilityGeneration">,
  ): void {
    if (!sameValue(current.contractInstance, request.contractInstance)) {
      throw new Error("Contract Instance identity or generation mismatch.");
    }
    if (current.capabilityGeneration !== request.expectedCapabilityGeneration) {
      throw new Error("Provider capability generation mismatch.");
    }
  }

  async #requireActive(request: ProviderAuthoritySessionRequest): Promise<AuthorityState> {
    await this.#assertAccountActive();
    await this.#assertExpectedProvider(request.expectedProvider);
    return this.#requireLocallyActive(request);
  }

  #requireLocallyActive(request: ProviderAuthoritySessionRequest): AuthorityState {
    const authority = this.ctx.storage.kv.get<AuthorityState>(
      this.#authorityKey(request.contractInstance.id),
    );
    if (!authority || authority.state !== "active") throw new Error("Provider authority is not active.");
    this.#assertLifecycleExpectation(authority, request);
    return authority;
  }

  #assertNoApplyingAction(contractInstanceId: string): void {
    const applying = Array.from(this.ctx.storage.kv.list<StagedAction>({prefix: "action:"}))
      .some(([, action]) => action.contractInstance.id === contractInstanceId &&
        action.applyOperationId !== undefined);
    if (applying) throw new Error("Provider action reconciliation is still pending.");
  }

  #replayOperation(operationId: string, fingerprint: string): OperationRecord | undefined {
    const record = this.ctx.storage.kv.get<OperationRecord>(this.#operationKey(operationId));
    if (record && record.fingerprint !== fingerprint) {
      throw new Error("Authority Operation key was reused for a different request.");
    }
    return record;
  }

  #operationFingerprint(kind: string, request: unknown): string {
    return JSON.stringify({kind, request});
  }

  #lifecycleResult(state: AuthorityState): ProviderAuthorityLifecycleResult {
    return {
      provider: {
        providerId: PROVIDER_ID,
        accountId: this.ctx.props.accountId ?? this.ctx.id.toString(),
        sourceId: this.ctx.storage.kv.get<string>("provider:sourceId")!,
        sourceGeneration: this.ctx.storage.kv.get<number>("provider:sourceGeneration") ?? 1,
      },
      contractInstance: structuredClone(state.contractInstance),
      backingReference: state.backingReference,
      capabilityGeneration: state.capabilityGeneration,
      state: state.state,
      cleanup: state.cleanup,
    };
  }

  async #cleanupBacking(state: AuthorityState): Promise<void> {
    const prefix = this.#stagingPrefix(state);
    let cursor: string | undefined;
    do {
      const page = await this.env.STORAGE.list({prefix, cursor, limit: 1000});
      for (const object of page.objects) await this.env.STORAGE.delete(object.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  #authorityKey(contractInstanceId: string): string {
    return `authority:${contractInstanceId}`;
  }

  #operationKey(operationId: string): string {
    return `operation:${operationId}`;
  }

  #actionKey(actionId: string): string {
    return `action:${actionId}`;
  }

  #accountId(): string {
    return this.ctx.props.accountId ?? this.ctx.id.toString();
  }

  #objectsPrefix(): string {
    return `accounts/${this.#accountId()}/objects/`;
  }

  #objectKey(key: string): string {
    return this.#objectsPrefix() + key;
  }

  #stagingPrefix(state: AuthorityState): string {
    return `provider-authority/${state.storageNonce}/staging/`;
  }

  #stagingKey(state: AuthorityState, actionId: string): string {
    return `${this.#stagingPrefix(state)}${actionId}`;
  }
}
