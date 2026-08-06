import type {RpcStub, RpcTarget} from "cloudflare:workers";

/** Stable prefix used for Contract-owned persistent restoration parameters. */
export const CONTRACT_RESTORATION_STORAGE_PREFIX = "contract:restoration:";

/** Produces the local-storage key for one Contract-owned restoration record. */
export function contractRestorationStorageKey(restorationId: string): string {
  if (!restorationId) throw new TypeError("Contract restoration ID must not be empty.");
  return `${CONTRACT_RESTORATION_STORAGE_PREFIX}${restorationId}`;
}

/** Narrow Manager capability used by a Contract facet to mint retractable restored stubs. */
export interface ContractRestoreHost {
  restore<T extends RpcTarget>(restorationId: string): RpcStub<T>;
}

