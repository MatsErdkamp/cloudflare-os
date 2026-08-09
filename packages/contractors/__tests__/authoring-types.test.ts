import { expectTypeOf, it } from "vitest";

import type {
  ContractCapabilityRestorer,
  ContractContext,
} from "../src/authoring/index";

interface EmailSource {
  readEmail(id: string): Promise<{ readonly subject: string }>;
}

it("types persistent restoration with the full Source-bearing Contract context", () => {
  expectTypeOf<Parameters<ContractCapabilityRestorer<EmailSource>>[0]>()
    .toEqualTypeOf<ContractContext<EmailSource>>();
});

it("exposes direct approval without obsolete policy or arbitrary caller records", () => {
  type Context = ContractContext<EmailSource>;
  expectTypeOf<Context["approval"]["manual"]>().toBeFunction();
  expectTypeOf<Context["invocation"]["generations"]["binding"]>().toBeNumber();
  type ContextKeys = keyof Context;
  expectTypeOf<"policy">().not.toMatchTypeOf<ContextKeys>();
  expectTypeOf<"caller">().not.toMatchTypeOf<ContextKeys>();
});
