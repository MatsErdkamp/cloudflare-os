import type {RpcTarget} from "cloudflare:workers";

/** HTTP metadata retained with an object. */
export interface R2HttpMetadata {
  /** MIME type of the object body. */
  contentType?: string;
  /** Browser download filename/disposition metadata. */
  contentDisposition?: string;
  /** Cache-Control value stored with the object. */
  cacheControl?: string;
  /** Content-Encoding value stored with the object. */
  contentEncoding?: string;
  /** Content-Language value stored with the object. */
  contentLanguage?: string;
}

/** Metadata for one object in the private storage root. */
export interface R2StoredObject {
  /** Object key relative to this storage root. */
  key: string;
  /** Object body size in bytes. */
  size: number;
  /** Entity tag assigned by R2. */
  etag: string;
  /** Upload time. */
  uploaded: Date;
  /** Stored HTTP metadata, when present. */
  httpMetadata?: R2HttpMetadata;
  /** Caller-defined string metadata. */
  customMetadata?: Record<string, string>;
}

/** Object metadata plus a bounded body copied by value. */
export interface R2StoredObjectBody extends R2StoredObject {
  /** Object contents, limited to the Source's documented maximum object size. */
  body: Uint8Array;
}

/** Options accepted when writing an object. */
export interface R2PutOptions {
  /** HTTP metadata stored with the object. */
  httpMetadata?: R2HttpMetadata;
  /** Caller-defined string metadata stored with the object. */
  customMetadata?: Record<string, string>;
}

/** Options for one bounded object listing page. */
export interface R2ListOptions {
  /** Return only keys beginning with this prefix. */
  prefix?: string;
  /** Opaque cursor returned by a previous call using the same prefix and delimiter. */
  cursor?: string;
  /** Maximum objects to return, from 1 through 1000. */
  limit?: number;
  /** Group keys at this delimiter; `/` provides folder-like grouping. */
  delimiter?: string;
}

/** One bounded object listing page. */
export interface R2ObjectPage {
  /** Objects in this page. */
  objects: R2StoredObject[];
  /** Grouped prefixes when a delimiter was requested. */
  delimitedPrefixes: string[];
  /** Whether another page exists. */
  truncated: boolean;
  /** Cursor to pass to the next call when truncated. */
  cursor?: string;
}

/** Private object storage rooted in this connected account's namespace. */
export interface R2BucketSession extends RpcTarget {
  /** Returns object metadata, or null when the key does not exist. */
  head(key: string): Promise<R2StoredObject | null>;
  /** Returns object metadata and a bounded body, or null when the key does not exist. */
  get(key: string): Promise<R2StoredObjectBody | null>;
  /** Stages an object write and returns its resulting metadata. */
  put(
    key: string,
    body: Uint8Array | string,
    options?: R2PutOptions,
  ): Promise<R2StoredObject>;
  /** Lists one bounded page of objects. */
  list(options?: R2ListOptions): Promise<R2ObjectPage>;
  /** Stages deletion of one object. Missing keys are accepted. */
  delete(key: string): Promise<void>;
}
