import { expectTypeOf, it } from "vitest";

import type {
  ContractCapabilityRestorer,
  ContractContext,
} from "../src/index";

interface EmailSource {
  readEmail(id: string): Promise<{ readonly subject: string }>;
}

it("types persistent restoration with the full Source-bearing Contract context", () => {
  expectTypeOf<Parameters<ContractCapabilityRestorer<EmailSource>>[0]>()
    .toEqualTypeOf<ContractContext<EmailSource>>();
});
