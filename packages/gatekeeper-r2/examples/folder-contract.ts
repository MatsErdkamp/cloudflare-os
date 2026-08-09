import {
  defineContract,
  type ContractApproval,
} from "@gadgets/contractors/authoring";
import { RpcTarget } from "cloudflare:workers";
import type { Source } from "contract:source";

const ROOT_PREFIX = "shared/";

/** HTTP metadata retained with a folder object. */
export interface FolderHttpMetadata {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
  contentEncoding?: string;
  contentLanguage?: string;
}

/** Metadata for an object whose key is relative to this Folder capability. */
export interface FolderObject {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: FolderHttpMetadata;
  customMetadata?: Record<string, string>;
}

/** A folder object with a streaming body. */
export interface FolderObjectBody extends FolderObject {
  body: ReadableStream<Uint8Array>;
}

/** Options accepted when writing through a Folder capability. */
export interface FolderPutOptions {
  httpMetadata?: FolderHttpMetadata;
  customMetadata?: Record<string, string>;
}

/** One bounded listing page relative to a Folder capability. */
export interface FolderObjectPage {
  objects: FolderObject[];
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
}

/** Prefix-scoped object storage. Every path is relative and cannot escape this folder. */
export interface ContractBinding extends RpcTarget {
  /** Returns object metadata, or null when the relative path does not exist. */
  head(path: string): Promise<FolderObject | null>;
  /** Returns a streaming object body, or null when the relative path does not exist. */
  get(path: string): Promise<FolderObjectBody | null>;
  /** Writes an object inside this folder. */
  put(
    path: string,
    body: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: FolderPutOptions,
  ): Promise<FolderObject>;
  /** Lists one bounded page without revealing the private backing prefix. */
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
    delimiter?: string;
  }): Promise<FolderObjectPage>;
  /** Deletes one object after a Contract-authored human approval. */
  delete(path: string): Promise<void>;
  /** Returns a narrower live capability rooted beneath this folder. */
  subfolder(path: string): Promise<ContractBinding>;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function relativePath(path: string, allowEmpty = false): string {
  if (typeof path !== "string" || (!allowEmpty && path.length === 0)) {
    throw new TypeError("Folder paths must be non-empty strings.");
  }
  if (path.startsWith("/") || path.includes("\\") || /%(?:2e|2f|5c)/i.test(path)) {
    throw new TypeError("Folder paths must be unencoded relative paths.");
  }
  if (path.includes("\u2215") || path.includes("\u2044")) {
    throw new TypeError("Folder paths cannot contain lookalike path separators.");
  }
  if (hasControlCharacters(path)) {
    throw new TypeError("Folder paths cannot contain control characters.");
  }
  const segments = path.split("/");
  if (segments.some(segment => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError("Folder paths cannot contain empty, dot, or parent segments.");
  }
  return path;
}

function folderPrefix(path: string): string {
  return `${relativePath(path)}/`;
}

function normalizedPrefix(prefix: string): string {
  if (prefix === "") return "";
  const trailingSlash = prefix.endsWith("/");
  const path = relativePath(trailingSlash ? prefix.slice(0, -1) : prefix);
  return trailingSlash ? `${path}/` : path;
}

function stripScopedPrefix(value: string, prefix: string): string {
  if (!value.startsWith(prefix)) {
    throw new Error("The R2 Source returned an object outside this folder capability.");
  }
  return value.slice(prefix.length);
}

class FolderImpl extends RpcTarget implements ContractBinding {
  constructor(
    private readonly source: Source,
    private readonly prefix: string,
    private readonly approval: ContractApproval<Source>,
  ) {
    super();
  }

  async head(path: string): Promise<FolderObject | null> {
    const relative = relativePath(path);
    const object = await this.source.head(this.prefix + relative);
    return object ? { ...object, key: relative } : null;
  }

  async get(path: string): Promise<FolderObjectBody | null> {
    const relative = relativePath(path);
    const object = await this.source.get(this.prefix + relative);
    return object ? { ...object, key: relative } : null;
  }

  async put(
    path: string,
    body: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: FolderPutOptions,
  ): Promise<FolderObject> {
    const relative = relativePath(path);
    const object = await this.source.put(this.prefix + relative, body, options);
    return { ...object, key: relative };
  }

  async list(options: {
    prefix?: string;
    cursor?: string;
    limit?: number;
    delimiter?: string;
  } = {}): Promise<FolderObjectPage> {
    const relativePrefix = options.prefix
      ? normalizedPrefix(options.prefix)
      : "";
    const page = await this.source.list({
      ...options,
      prefix: this.prefix + relativePrefix,
    });
    return {
      ...page,
      objects: page.objects.map(object => ({
        ...object,
        key: stripScopedPrefix(object.key, this.prefix),
      })),
      delimitedPrefixes: page.delimitedPrefixes.map(prefix =>
        stripScopedPrefix(prefix, this.prefix)),
    };
  }

  async delete(path: string): Promise<void> {
    const relative = relativePath(path);
    const key = this.prefix + relative;
    await this.approval.manual({
      title: "Delete folder object",
      description: `Delete ${relative} from this scoped R2 folder.`,
    }, async ({ source }) => {
      await source.delete(key);
    });
  }

  async subfolder(path: string): Promise<ContractBinding> {
    return new FolderImpl(this.source, this.prefix + folderPrefix(path), this.approval);
  }
}

export default defineContract<Source, ContractBinding>(context =>
  new FolderImpl(context.source, ROOT_PREFIX, context.approval));
