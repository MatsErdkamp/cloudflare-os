/** Capability exposed to the one-choice R2 resource configurator. */
export interface R2RootConfiguratorRpc {
  /** Returns the private storage-root resource URL. */
  resourceUrl(): Promise<string>;
}

/** The R2 root configurator has no user-editable values. */
export type R2RootConfiguratorValues = Record<string, never>;
