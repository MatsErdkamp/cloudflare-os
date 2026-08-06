import {
  DurableObject,
  RpcStub,
  RpcTarget,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  ActionKind,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ResourceConfiguratorFrame,
  ResourceDescription,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type {
  R2BucketSession,
  R2HttpMetadata,
  R2ListOptions,
  R2ObjectPage,
  R2PutOptions as PublicR2PutOptions,
  R2StoredObject,
  R2StoredObjectBody,
} from "./types.js";
import type { R2RootConfiguratorRpc } from "./configurator/root-configurator-types.js";
import TYPES_CODE from "./types.txt";
import CONFIGURATOR_HTML from "./generated/root-configurator-ui.txt";

const RESOURCE_URL = "r2://storage/root";
const INTERNAL_SEGMENT = ".gatekeeper/";
const VENDOR_ID = "r2";
const MAX_KEY_BYTES = 1024;

const R2_ICON = {
  url: "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'>" +
    "<rect width='256' height='256' rx='48' fill='#f48120'/>" +
    "<path fill='white' d='M58 72h93c30 0 49 16 49 42 0 18-9 31-25 38l30 32h-43l-25-27H96v27H58V72Zm38 31v24h50c10 0 16-4 16-12s-6-12-16-12H96Z'/>" +
    "</svg>"),
};

const ROOT_RESOURCE: SupportedResource = {
  urlPattern: RESOURCE_URL,
  title: "R2 Private Storage",
  description: "Private streaming object storage for this connected account.",
};

type Env = Cloudflare.Env;
type AccountProps = { accountId: string };
type GatekeeperProps = { accountId?: string };

interface R2SessionDriver {
  readHead(key: string): Promise<R2StoredObject | null>;
  readObject(key: string): Promise<R2StoredObjectBody | null>;
  readList(
    options: Required<Pick<R2ListOptions, "prefix" | "limit">> &
      Pick<R2ListOptions, "cursor" | "delimiter">,
  ): Promise<R2ObjectPage>;
  stagePut(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: PublicR2PutOptions,
  ): Promise<{ actionId: number; object: R2StoredObject }>;
  stageDelete(key: string): Promise<number>;
  rejectAction(actionId: number): Promise<void>;
}

type StoredAction =
  | {
      id: number;
      type: "put";
      key: string;
      stagingKey: string;
    }
  | {
      id: number;
      type: "delete";
      key: string;
    };

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function assertLogicalKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("R2 object keys must be non-empty strings.");
  }
  if (key.startsWith(INTERNAL_SEGMENT)) {
    throw new TypeError(`R2 object keys cannot begin with ${INTERNAL_SEGMENT}.`);
  }
  if (hasControlCharacters(key)) {
    throw new TypeError("R2 object keys cannot contain control characters.");
  }
  if (new TextEncoder().encode(key).byteLength > MAX_KEY_BYTES) {
    throw new RangeError(`R2 object keys cannot exceed ${MAX_KEY_BYTES} UTF-8 bytes.`);
  }
}

function assertLogicalPrefix(prefix: string): void {
  if (typeof prefix !== "string") throw new TypeError("R2 prefixes must be strings.");
  if (prefix.startsWith(INTERNAL_SEGMENT)) {
    throw new TypeError(`R2 prefixes cannot begin with ${INTERNAL_SEGMENT}.`);
  }
  if (hasControlCharacters(prefix)) {
    throw new TypeError("R2 prefixes cannot contain control characters.");
  }
  if (new TextEncoder().encode(prefix).byteLength > MAX_KEY_BYTES) {
    throw new RangeError(`R2 prefixes cannot exceed ${MAX_KEY_BYTES} UTF-8 bytes.`);
  }
}

function normalizeListOptions(options: R2ListOptions = {}): Required<Pick<R2ListOptions, "prefix" | "limit">> &
    Pick<R2ListOptions, "cursor" | "delimiter"> {
  const prefix = options.prefix ?? "";
  assertLogicalPrefix(prefix);
  const limit = options.limit ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("R2 list limit must be an integer from 1 through 1000.");
  }
  if (options.cursor !== undefined &&
      (typeof options.cursor !== "string" || options.cursor.length === 0)) {
    throw new TypeError("R2 list cursor must be a non-empty string.");
  }
  if (options.delimiter !== undefined &&
      (typeof options.delimiter !== "string" || options.delimiter.length === 0)) {
    throw new TypeError("R2 list delimiter must be a non-empty string.");
  }
  if (options.delimiter && hasControlCharacters(options.delimiter)) {
    throw new TypeError("R2 list delimiters cannot contain control characters.");
  }
  return { prefix, limit, cursor: options.cursor, delimiter: options.delimiter };
}

function publicHttpMetadata(metadata?: R2HTTPMetadata): R2HttpMetadata | undefined {
  if (!metadata) return undefined;
  const result: R2HttpMetadata = {
    contentType: metadata.contentType,
    contentDisposition: metadata.contentDisposition,
    cacheControl: metadata.cacheControl,
    contentEncoding: metadata.contentEncoding,
    contentLanguage: metadata.contentLanguage,
  };
  return Object.values(result).some(value => value !== undefined) ? result : undefined;
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

function publicObjectBody(object: R2ObjectBody, key: string): R2StoredObjectBody {
  return { ...publicObject(object, key), body: object.body };
}

function toNativePutOptions(options?: PublicR2PutOptions): R2PutOptions | undefined {
  if (!options) return undefined;
  return {
    httpMetadata: options.httpMetadata,
    customMetadata: options.customMetadata,
  };
}

/** Durable revocation marker for one auto-provisioned R2 account. */
@validateRpc()
export class R2AccountState extends DurableObject<Env> {
  /** Throws after the owning connected account has been revoked. */
  assertActive(): void {
    if (this.ctx.storage.kv.get<boolean>("revoked")) {
      throw new Error("This R2 storage account has been revoked.");
    }
  }

  /** Permanently revokes the connected account capability without deleting its objects. */
  revoke(): void {
    this.ctx.storage.kv.put("revoked", true);
  }
}

@validateRpc()
class R2RootConfigurator extends RpcTarget implements R2RootConfiguratorRpc {
  /** Returns the one resource URL this account can bind. */
  async resourceUrl(): Promise<string> {
    return RESOURCE_URL;
  }
}

@validateRpc()
export class R2SessionImpl extends RpcTarget implements R2BucketSession {
  constructor(
    private readonly driver: R2SessionDriver,
    private readonly approvalQueue: RpcStub<ApprovalQueue>,
  ) {
    super();
  }

  /** Reads object metadata after recording an observation. */
  async head(key: string): Promise<R2StoredObject | null> {
    assertLogicalKey(key);
    const object = await this.driver.readHead(key);
    await this.approvalQueue.authorizeObservation({
      title: "Read R2 object metadata",
      description: `Read metadata for object ${key}.`,
    });
    return object;
  }

  /** Reads an object's streaming body after recording an observation. */
  async get(key: string): Promise<R2StoredObjectBody | null> {
    assertLogicalKey(key);
    const object = await this.driver.readObject(key);
    try {
      await this.approvalQueue.authorizeObservation({
        title: "Read R2 object",
        description: `Read object ${key}.`,
      });
    } catch (error) {
      await object?.body.cancel(error).catch(() => {});
      throw error;
    }
    return object;
  }

  /** Stages an object write and submits it through the action queue. */
  async put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: PublicR2PutOptions,
  ): Promise<R2StoredObject> {
    assertLogicalKey(key);
    const staged = await this.driver.stagePut(key, body, options);
    try {
      await this.approvalQueue.submitAction(staged.actionId, {
        title: "Write R2 object",
        description: `Write object ${key} (${staged.object.size} bytes).`,
        implementsRevert: false,
      });
      return staged.object;
    } catch (error) {
      await this.driver.rejectAction(staged.actionId);
      throw error;
    }
  }

  /** Lists a bounded page after recording an observation. */
  async list(options?: R2ListOptions): Promise<R2ObjectPage> {
    const normalized = normalizeListOptions(options);
    const page = await this.driver.readList(normalized);
    await this.approvalQueue.authorizeObservation({
      title: "List R2 objects",
      description: normalized.prefix
        ? `List objects under prefix ${normalized.prefix}.`
        : "List objects in private R2 storage.",
    });
    return page;
  }

  /** Stages deletion of one object and submits it through the action queue. */
  async delete(key: string): Promise<void> {
    assertLogicalKey(key);
    const actionId = await this.driver.stageDelete(key);
    try {
      await this.approvalQueue.submitAction(actionId, {
        title: "Delete R2 object",
        description: `Delete object ${key}.`,
        implementsRevert: false,
      });
    } catch (error) {
      await this.driver.rejectAction(actionId);
      throw error;
    }
  }

  [Symbol.dispose](): void {
    this.approvalQueue[Symbol.dispose]();
  }
}

@validateRpc()
export class R2Gatekeeper extends DurableObject<Env, GatekeeperProps>
    implements Gatekeeper<R2BucketSession> {
  /** Describes the account-isolated private storage root. */
  async describe(): Promise<ResourceDescription> {
    await this.#assertActive();
    return {
      url: RESOURCE_URL,
      title: "R2 Private Storage",
      snippet: "Streaming object storage isolated to this connected account.",
      suggestedBindingName: "R2_STORAGE",
      tsType: "R2BucketSession",
    };
  }

  /** Returns the complete R2 Source declarations. */
  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  /** R2 writes are never eligible for generic Gatekeeper auto-approval. */
  async getAutoApprovableActions(): Promise<ActionKind[]> {
    return [];
  }

  /** Opens a Source session that owns its approval-queue duplicate. */
  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<R2BucketSession> {
    await this.#assertActive();
    const driver: R2SessionDriver = {
      readHead: key => this.#readHead(key),
      readObject: key => this.#readObject(key),
      readList: options => this.#readList(options),
      stagePut: (key, body, options) => this.#stagePut(key, body, options),
      stageDelete: key => this.#stageDelete(key),
      rejectAction: actionId => this.#rejectAction(actionId),
    };
    return new R2SessionImpl(driver, approvalQueue.dup());
  }

  async #readHead(key: string): Promise<R2StoredObject | null> {
    await this.#assertActive();
    const pending = this.#latestActionForKey(key);
    if (pending?.type === "delete") return null;
    if (pending?.type === "put") {
      const staged = await this.env.STORAGE.head(pending.stagingKey);
      return staged ? publicObject(staged, key) : null;
    }
    const object = await this.env.STORAGE.head(this.#objectKey(key));
    return object ? publicObject(object, key) : null;
  }

  async #readObject(key: string): Promise<R2StoredObjectBody | null> {
    await this.#assertActive();
    const pending = this.#latestActionForKey(key);
    if (pending?.type === "delete") return null;
    const physicalKey = pending?.type === "put" ? pending.stagingKey : this.#objectKey(key);
    const object = await this.env.STORAGE.get(physicalKey);
    return object ? publicObjectBody(object, key) : null;
  }

  async #readList(
    options: Required<Pick<R2ListOptions, "prefix" | "limit">> &
      Pick<R2ListOptions, "cursor" | "delimiter">,
  ): Promise<R2ObjectPage> {
    await this.#assertActive();
    const root = this.#objectsPrefix();
    const listed = await this.env.STORAGE.list({
      prefix: root + options.prefix,
      limit: options.limit,
      cursor: options.cursor,
      delimiter: options.delimiter,
      include: ["httpMetadata", "customMetadata"],
    });
    const actions = this.#latestActions();
    const objects = new Map<string, R2StoredObject>();
    for (const object of listed.objects) {
      const key = object.key.slice(root.length);
      const pending = actions.get(key);
      if (pending?.type === "delete") continue;
      objects.set(key, publicObject(object, key));
    }

    const delimitedPrefixes = new Set(
      listed.delimitedPrefixes.map(prefix => prefix.slice(root.length)),
    );
    return {
      objects: [...objects.values()],
      delimitedPrefixes: [...delimitedPrefixes].toSorted(),
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : undefined,
    };
  }

  async #stagePut(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: PublicR2PutOptions,
  ): Promise<{ actionId: number; object: R2StoredObject }> {
    await this.#assertActive();
    const actionId = this.#nextActionId();
    const stagingKey = this.#stagingKey(actionId);
    const staged = await this.env.STORAGE.put(stagingKey, body, toNativePutOptions(options));
    const action: StoredAction = { id: actionId, type: "put", key, stagingKey };
    this.ctx.storage.kv.put(`action:${actionId}`, action);
    return { actionId, object: publicObject(staged, key) };
  }

  async #stageDelete(key: string): Promise<number> {
    await this.#assertActive();
    const actionId = this.#nextActionId();
    const action: StoredAction = { id: actionId, type: "delete", key };
    this.ctx.storage.kv.put(`action:${actionId}`, action);
    return actionId;
  }

  /** Applies a previously staged write or deletion. */
  async applyAction(actionId: number): Promise<void> {
    await this.#assertActive();
    const action = this.#requireAction(actionId);
    if (action.type === "delete") {
      await this.env.STORAGE.delete(this.#objectKey(action.key));
    } else {
      const staged = await this.env.STORAGE.get(action.stagingKey);
      if (!staged) throw new Error(`Staged R2 upload ${actionId} no longer exists.`);
      await this.env.STORAGE.put(this.#objectKey(action.key), staged.body, {
        httpMetadata: staged.httpMetadata,
        customMetadata: staged.customMetadata,
      });
      await this.env.STORAGE.delete(action.stagingKey);
    }
    this.ctx.storage.kv.delete(`action:${actionId}`);
  }

  /** Discards a staged action and any invisible upload body. */
  async rejectAction(actionId: number): Promise<void> {
    await this.#rejectAction(actionId);
  }

  async #rejectAction(actionId: number): Promise<void> {
    const action = this.ctx.storage.kv.get<StoredAction>(`action:${actionId}`);
    if (!action) return;
    if (action.type === "put") await this.env.STORAGE.delete(action.stagingKey);
    this.ctx.storage.kv.delete(`action:${actionId}`);
  }

  /** Reports that applied R2 mutations cannot be automatically reverted. */
  async revertAction(
    _actionId: number,
  ): Promise<{ message: string; canRetry: false; restart: false }> {
    return {
      message: "R2 writes and deletions cannot be automatically reverted.",
      canRetry: false,
      restart: false,
    };
  }

  /** Refuses collaborators because each auto-provisioned account root is private to its owner. */
  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    throw new Error("Private R2 storage cannot be observed by workspace collaborators.");
  }

  /** No observer state is retained. */
  async removeObserver(_id: string): Promise<void> {}

  #accountId(): string {
    return this.ctx.props.accountId ?? this.ctx.id.toString();
  }

  #accountState(): DurableObjectStub<R2AccountState> {
    const namespace = this.ctx.exports.R2AccountState;
    return namespace.get(namespace.idFromString(this.#accountId()));
  }

  async #assertActive(): Promise<void> {
    // Direct test bindings do not carry account props and therefore have no account-state object.
    if (this.ctx.props.accountId) await this.#accountState().assertActive();
  }

  #accountPrefix(): string {
    return `accounts/${this.#accountId()}/`;
  }

  #objectsPrefix(): string {
    return `${this.#accountPrefix()}objects/`;
  }

  #objectKey(key: string): string {
    return this.#objectsPrefix() + key;
  }

  #stagingKey(actionId: number): string {
    return `${this.#accountPrefix()}staging/${this.ctx.id.toString()}/${actionId}`;
  }

  #nextActionId(): number {
    const actionId = this.ctx.storage.kv.get<number>("nextActionId") ?? 1;
    this.ctx.storage.kv.put("nextActionId", actionId + 1);
    return actionId;
  }

  #requireAction(actionId: number): StoredAction {
    const action = this.ctx.storage.kv.get<StoredAction>(`action:${actionId}`);
    if (!action) throw new Error(`No pending R2 action ${actionId}.`);
    return action;
  }

  #latestActions(): Map<string, StoredAction> {
    const latest = new Map<string, StoredAction>();
    for (const [, action] of this.ctx.storage.kv.list<StoredAction>({ prefix: "action:" })) {
      const previous = latest.get(action.key);
      if (!previous || previous.id < action.id) latest.set(action.key, action);
    }
    return latest;
  }

  #latestActionForKey(key: string): StoredAction | undefined {
    return this.#latestActions().get(key);
  }
}

@validateRpc()
export class R2Account extends WorkerEntrypoint<Env, AccountProps> implements GatekeeperUser {
  /** Describes the account without making its raw Source ambient. */
  async describe(): Promise<AccountDescription> {
    await this.#state().assertActive();
    return { displayName: "R2 Private Storage", avatar: R2_ICON };
  }

  /** Returns the one grantable private storage root. */
  async getSupportedResources(): Promise<SupportedResource[]> {
    await this.#state().assertActive();
    return [ROOT_RESOURCE];
  }

  /** Binds the exact private-root resource to an account-imbued Gatekeeper facet class. */
  async getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<R2BucketSession>>;
    resource: SupportedResource;
  }> {
    await this.#state().assertActive();
    if (url !== RESOURCE_URL) throw new Error(`Unsupported R2 storage resource URL: ${url}`);
    return {
      class: this.ctx.exports.R2Gatekeeper({ props: this.ctx.props }),
      resource: ROOT_RESOURCE,
    };
  }

  /** Opens the one-choice private-root configurator. */
  async startResourceConfigurator(resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    await this.#state().assertActive();
    if (resourceUrlPattern !== RESOURCE_URL) {
      throw new Error(`Unsupported R2 configurator type: ${resourceUrlPattern}`);
    }
    return {
      iframeHtml: CONFIGURATOR_HTML,
      ui: new RpcStub(new R2RootConfigurator()),
    };
  }

  /** Confirms that the account already carries its only resource authority. */
  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    await this.#state().assertActive();
    return {};
  }

  /** Revokes this account while retaining its stored objects for deployment-level recovery. */
  async revoke(): Promise<void> {
    await this.#state().revoke();
  }

  /** Rejects reconnect because R2 storage has no external credentials. */
  reconnect(): Promise<{ url: string }> {
    throw new Error("R2 storage is auto-provisioned and has no reconnect flow.");
  }

  /** Returns no sign-in identity. */
  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  /** Mints the opaque verifier required by the private-only observer policy. */
  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.R2Verifier({ props: this.ctx.props });
  }

  #state(): DurableObjectStub<R2AccountState> {
    const namespace = this.ctx.exports.R2AccountState;
    return namespace.get(namespace.idFromString(this.ctx.props.accountId));
  }
}

@validateRpc()
export class R2Verifier extends WorkerEntrypoint<Env, AccountProps>
    implements GatekeeperUserVerifier {
  /** Keeps this opaque verifier registered as a concrete entrypoint. */
  verify(): void {}
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Env> {
  /** Describes account-isolated R2 object storage. */
  async describe(): Promise<VendorDescription> {
    return {
      displayName: "R2 Storage",
      url: "https://developers.cloudflare.com/r2/",
      logo: R2_ICON,
      color: "#fff3e8",
      tagline: "Private streaming storage for Gadgets",
      description:
        "Connect an isolated R2 object namespace as a private Source, then use Contracts to " +
        "publish narrowly scoped folder capabilities.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }

  /** Mints a new opaque storage account with its own physical key namespace. */
  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    const accountId = this.ctx.exports.R2AccountState.newUniqueId().toString();
    return this.ctx.exports.R2Account({ props: { accountId } });
  }

  /** Rejects interactive connection because storage accounts are auto-provisioned. */
  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("R2 storage is auto-provisioned and has no connect flow.");
  }

  /** Returns the private-root resource shape available after account provisioning. */
  async getSupportedResources(): Promise<SupportedResource[]> {
    return [ROOT_RESOURCE];
  }

  /** Returns the complete agent-facing R2 Source declarations. */
  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}

export { VENDOR_ID };
