import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import type { ContractRetractionTestHost } from "./contract-retraction-test-host.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_CONTRACT_HOST: DurableObjectNamespace<ContractRetractionTestHost>;
  }
}

type CapabilityGraph = Awaited<ReturnType<ContractRetractionTestHost["openGraph"]>>;

async function expectGraphLive(graph: CapabilityGraph): Promise<void> {
  await expect(graph.root.read()).resolves.toBe("root");
  await expect(graph.customChild.read()).resolves.toBe("contract-child");
  await expect(graph.delegatedSource.read()).resolves.toBe("source");
  await expect(graph.delegatedChild.read()).resolves.toBe("source-child");
  await expect(graph.manualDelegatedSource.read()).resolves.toBe("source");
  await expect(graph.manualDelegatedChild.read()).resolves.toBe("source-child");
  await expect(graph.cursor.read()).resolves.toBe("cursor");
  await expect(graph.mappedDelegation.get("child").read()).resolves.toBe("mapped-child");
  await expect(graph.functionValue("value")).resolves.toBe("function:value");
  await expect(graph.restored.read()).resolves.toBe("restored:source");
  await expect(graph.root.bindingNames()).resolves.toEqual([]);
  await expect(graph.root.networkBlocked()).resolves.toBe(true);
}

async function expectGraphRetracted(graph: CapabilityGraph): Promise<void> {
  for (const call of [
    () => graph.root.read(),
    () => graph.customChild.read(),
    () => graph.delegatedSource.read(),
    () => graph.delegatedChild.read(),
    () => graph.manualDelegatedSource.read(),
    () => graph.manualDelegatedChild.read(),
    () => graph.cursor.read(),
    () => graph.mappedDelegation.get("child").read(),
    () => graph.functionValue("value"),
    () => graph.restored.read(),
  ]) {
    await expect(Promise.resolve().then(call)).rejects.toThrow();
  }
}

describe("Contract facet retraction conformance", () => {
  it("retracts root, derived, forwarded, function, cursor, and restored capabilities", async () => {
    const host = env.TEST_CONTRACT_HOST.getByName("contract-retraction-same-request");
    const graph = await host.openGraph();
    await expectGraphLive(graph);
    await host.deleteContract();
    await expectGraphRetracted(graph);
  }, 15_000);

  it("keeps the graph retracted when used through a newly acquired host stub", async () => {
    const name = "contract-retraction-later-request";
    const graph = await env.TEST_CONTRACT_HOST.getByName(name).openGraph();
    await expectGraphLive(graph);
    await env.TEST_CONTRACT_HOST.getByName(name).deleteContract();
    await expectGraphRetracted(graph);
  }, 15_000);

  it("isolates local facet storage per instance and deletes it with the facet", async () => {
    const left = env.TEST_CONTRACT_HOST.getByName("contract-state-left");
    const right = env.TEST_CONTRACT_HOST.getByName("contract-state-right");
    await expect(left.increment()).resolves.toBe(1);
    await expect(left.increment()).resolves.toBe(2);
    await expect(right.increment()).resolves.toBe(1);
    await left.deleteContract();
    await expect(left.increment()).resolves.toBe(1);
    await expect(right.increment()).resolves.toBe(2);
  });
});
