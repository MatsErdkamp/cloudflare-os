import type { RpcTarget } from "cloudflare:workers";

import type { ContractFactory } from "./contract-module.js";

/** Declares a Contract factory without adding or interpreting policy. */
export function defineContract<Source, Binding extends RpcTarget>(
  factory: ContractFactory<Source, Binding>,
): ContractFactory<Source, Binding> {
  return factory;
}
