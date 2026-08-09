import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import type { ContractLifecycleConformanceHost } from "./contract-lifecycle-conformance-host.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_CONTRACT_LIFECYCLE: DurableObjectNamespace<ContractLifecycleConformanceHost>;
  }
}

let sequence = 0;

function host(label: string) {
  return env.TEST_CONTRACT_LIFECYCLE.getByName(`${label}-${sequence++}`);
}

describe("Contract lifecycle harness conformance", () => {
  it("requires exact installation and invalidates stale roots, children, and nested capabilities", async () => {
    const endpoint = host("graph");
    await expect(endpoint.install()).resolves.toMatchObject({ reachabilityGeneration: 1 });
    const root = await endpoint.openRoot();
    await expect(endpoint.installAgain()).resolves.toMatchObject({ reachabilityGeneration: 1 });
    const child = await root.child();
    const providerChild = await root.providerChild();
    const nested = await root.nested();

    await expect(root.read()).resolves.toBe("root-live");
    await expect(child.read()).resolves.toBe("local-child");
    await expect(providerChild.read()).resolves.toBe("provider-child");
    await expect(nested.array[0].read()).resolves.toBe("provider-child");
    await expect(nested.map.get("child").read()).resolves.toBe("provider-child");

    await expect(endpoint.invalidate()).resolves.toMatchObject({
      invalidated: true,
      reachabilityGeneration: 1,
    });
    for (const call of [
      () => root.read(),
      () => child.read(),
      () => providerChild.read(),
      () => nested.array[0].read(),
      () => nested.map.get("child").read(),
    ]) await expect(Promise.resolve().then(call)).rejects.toThrow();
    await expect(endpoint.invalidate()).resolves.toMatchObject({ invalidated: true });
  }, 15_000);

  it("rejects raw streams and raw iterators before transfer", async () => {
    const endpoint = host("unsupported-shapes");
    await endpoint.install();
    const root = await endpoint.openRoot();
    for (const call of [
      () => root.rawReadable(),
      () => root.rawWritable(),
      () => root.rawTransform(),
      () => root.rawIterator(),
      () => root.rawAbortSignal(),
    ]) await expect(Promise.resolve().then(call)).rejects.toThrow();
    await expect(endpoint.observations()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({type: "unsupportedShapeRejected", shape: "readableStream"}),
      expect.objectContaining({type: "unsupportedShapeRejected", shape: "writableStream"}),
      expect.objectContaining({type: "unsupportedShapeRejected", shape: "transformStream"}),
      expect.objectContaining({type: "unsupportedShapeRejected", shape: "asyncIterator"}),
      expect.objectContaining({type: "unsupportedShapeRejected", shape: "abortSignal"}),
    ]));
  });

  it("coalesces parallel invalidation behind one acknowledgement and cleanup", async () => {
    const endpoint = host("parallel-invalidation");
    await endpoint.install();
    await expect(endpoint.invalidateInParallel()).resolves.toEqual({
      first: expect.objectContaining({invalidated: true}),
      second: expect.objectContaining({invalidated: true}),
      upstreamCancellations: 1,
    });
  });

  it("coalesces recovery installation with an in-flight invalidation", async () => {
    const endpoint = host("install-invalidation-race");
    await endpoint.install();
    await expect(endpoint.installWhileInvalidating()).resolves.toEqual({
      installAcknowledgement: expect.objectContaining({invalidated: true}),
      invalidationAcknowledgement: expect.objectContaining({invalidated: true}),
      upstreamCancellations: 1,
    });
  });

  it("disposes the neutral observation capability after final delivery", async () => {
    const endpoint = host("observer-disposal");
    await endpoint.install();
    await endpoint.invalidate();
    await vi.waitFor(async () => expect(await endpoint.observerDisposals()).toBe(1));
  });

  it("drains a delayed quarantine observation before disposing its observer", async () => {
    const endpoint = host("delayed-observer-drain");
    await endpoint.install();
    await expect(endpoint.exerciseDelayedObservationDrain()).resolves.toEqual({
      observations: expect.arrayContaining(["invalidated", "resultQuarantined"]),
      observerDisposals: 1,
    });
  });

  it("recovers a durably prepared invalidation after the Facet is restarted", async () => {
    const endpoint = host("restart");
    await endpoint.install();
    const root = await endpoint.openRoot();
    await expect(endpoint.recoverPreparedInvalidation()).resolves.toMatchObject({
      invalidated: true,
      reachabilityGeneration: 1,
    });
    await expect(Promise.resolve().then(() => root.read())).rejects.toThrow();
  });

  it("executes a typed Contract-to-Contract chain and propagates cancellation upstream", async () => {
    const endpoint = host("composition");
    await expect(endpoint.exerciseComposition()).resolves.toEqual({
      live: "root-live",
      downstreamInvalidated: true,
      upstreamInvalidated: true,
      downstreamRootRejected: true,
      upstreamRootRejected: true,
    });
    await expect(endpoint.invalidCompositionDepthOutcome()).resolves.toContain(
      "composition lineage is invalid",
    );
  });

  it("rejects a provider-retained callback and disposes subscriptions after acknowledgement", async () => {
    const endpoint = host("retained");
    await endpoint.install();
    const root = await endpoint.openRoot();
    await root.registerCallback();
    const subscription = await root.subscribe();
    await expect(endpoint.invokeRetained()).resolves.toBe("callback:provider");
    await expect(subscription.ping()).resolves.toBe("subscribed");

    await endpoint.invalidate();
    await expect(Promise.resolve().then(() => endpoint.invokeRetained())).rejects.toThrow();
    await expect(Promise.resolve().then(() => subscription.ping())).rejects.toThrow();
    await vi.waitFor(async () => expect(await endpoint.subscriptionDisposals()).toBe(1));
    expect(await endpoint.upstreamCancellations()).toBe(1);
  });

  it("closes a pending result gate and quarantines its late capability", async () => {
    const endpoint = host("pending");
    await endpoint.install();
    await expect(endpoint.exercisePendingInvalidation()).resolves.toEqual({
      outcomes: ["rejected", "rejected"],
      cancelledInvocations: 2,
      observations: expect.arrayContaining(["resultQuarantined"]),
    });
  });

  it("restores only through the exact lifecycle-bound reference", async () => {
    const endpoint = host("restoration");
    await endpoint.install();
    const root = await endpoint.openRoot();
    const restored = await root.restored();
    await expect(restored.read()).resolves.toBe("restored:bound");
    await expect(endpoint.unsafeRestorationOutcome()).resolves.toContain("cannot contain accessors");
    for (const [field, value] of [
      ["endpointId", "changed-endpoint"],
      ["instanceId", "changed-instance"],
      ["instanceGeneration", 99],
      ["artifactHash", "sha256:changed-artifact"],
      ["runtimeProfileHash", "sha256:changed-profile"],
      ["reachabilityId", "changed-reachability"],
      ["reachabilityGeneration", 99],
      ["authoritySnapshotDigest", "sha256:changed-authority"],
    ] as const) {
      await expect(endpoint.restoreWithChangedField(field, value)).resolves.toContain("stale");
    }
    await endpoint.invalidate();
    await expect(Promise.resolve().then(() => restored.read())).rejects.toThrow();
  });
});
