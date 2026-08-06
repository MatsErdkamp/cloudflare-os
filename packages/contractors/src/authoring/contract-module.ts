import type { RpcTarget } from "cloudflare:workers";

import type { ContractContext } from "./contract-context.js";

/** Creates the public root capability for one Contract session. */
export type ContractFactory<Source, Binding extends RpcTarget> = (
  context: ContractContext<Source>,
) => Binding | Promise<Binding>;

/** Optional export used to rebuild persistent Contract-owned capabilities. */
export type ContractCapabilityRestorer<Source> = (
  context: ContractContext<Source>,
  params: unknown,
) => RpcTarget;
