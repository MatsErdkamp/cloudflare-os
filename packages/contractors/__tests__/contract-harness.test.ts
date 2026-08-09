import { describe, expect, it } from "vitest";

import {
  CONTRACT_HARNESS,
  CONTRACT_MAX_COMPOSITION_DEPTH,
} from "../src/runtime/index.js";

describe("Contract Dynamic Worker harness", () => {
  it("exposes the current direct-approval lifecycle runtime", () => {
    expect(CONTRACT_MAX_COMPOSITION_DEPTH).toBe(8);
    expect(CONTRACT_HARNESS).toContain("approval: createApproval(");
    expect(CONTRACT_HARNESS).toContain("invocation: closedInvocationEvidence(session.invocation)");
    expect(CONTRACT_HARNESS).toContain("async install(snapshot, observer, upstreamCancellation)");
    expect(CONTRACT_HARNESS).toContain("async beginInvalidation(expectedReachabilityGeneration)");
    expect(CONTRACT_HARNESS).toContain("invalidate(expectedReachabilityGeneration)");
    expect(CONTRACT_HARNESS).toContain("Raw streams require a generation-gated mediator");
    expect(CONTRACT_HARNESS).toContain("capabilityFreeParams(params)");
    expect(CONTRACT_HARNESS).toContain("Platform restoration is disabled");
    expect(CONTRACT_HARNESS).not.toContain("policy: createPolicy");
    expect(CONTRACT_HARNESS).not.toContain("caller: session.caller");
  });
});
