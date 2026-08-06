import { env, RpcStub, RpcTarget } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type {
  ActionDescription,
  ApprovalQueue,
  ObservationDescription,
} from "@gadgets/workshop-shared/gatekeeper";

import { R2SessionImpl, type R2Gatekeeper } from "../src/r2.js";
import type { R2BucketSession } from "../src/types.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv {
    TEST_R2_GATEKEEPER: DurableObjectNamespace<R2Gatekeeper>;
    STORAGE: R2Bucket;
  }
}

class RecordingApprovalQueue extends RpcTarget {
  readonly actions: Array<{ id: number; description: ActionDescription }> = [];
  readonly observations: ObservationDescription[] = [];

  async submitAction(id: number, description: ActionDescription): Promise<void> {
    this.actions.push({ id, description });
  }

  async authorizeObservation(description: ObservationDescription): Promise<void> {
    this.observations.push(description);
  }
}

async function openSession(name: string): Promise<{
  gatekeeper: DurableObjectStub<R2Gatekeeper>;
  queue: RecordingApprovalQueue;
  session: R2BucketSession;
}> {
  const gatekeeper = env.TEST_R2_GATEKEEPER.getByName(name);
  const queue = new RecordingApprovalQueue();
  const session = await gatekeeper.startSession(
    new RpcStub(queue) as RpcStub<ApprovalQueue>,
  );
  return { gatekeeper, queue, session };
}

async function bodyText(object: Awaited<ReturnType<R2BucketSession["get"]>>): Promise<string> {
  if (!object) throw new Error("Expected an R2 object body.");
  return new Response(object.body).text();
}

describe("R2Gatekeeper", () => {
  it("simulates staged writes and applies their streaming bodies", async () => {
    const { gatekeeper, queue, session } = await openSession("staged-write");
    try {
      const written = await session.put("shared/report.txt", "draft", {
        httpMetadata: { contentType: "text/plain" },
        customMetadata: { source: "test" },
      });

      expect(written).toMatchObject({
        key: "shared/report.txt",
        size: 5,
        httpMetadata: { contentType: "text/plain" },
        customMetadata: { source: "test" },
      });
      expect(queue.actions).toHaveLength(1);
      expect(await bodyText(await session.get("shared/report.txt"))).toBe("draft");
      expect((await session.list({ prefix: "shared/" })).objects).toEqual([]);

      await gatekeeper.applyAction(queue.actions[0]!.id);
      expect(await bodyText(await session.get("shared/report.txt"))).toBe("draft");
      expect((await session.list({ prefix: "shared/" })).objects).toMatchObject([
        { key: "shared/report.txt", size: 5 },
      ]);
      expect(queue.observations).toHaveLength(4);
    } finally {
      session[Symbol.dispose]();
    }
  });

  it("simulates deletions and restores the view when they are rejected", async () => {
    const { gatekeeper, queue, session } = await openSession("rejected-delete");
    try {
      await session.put("shared/keep.txt", "keep");
      await gatekeeper.applyAction(queue.actions[0]!.id);

      await session.delete("shared/keep.txt");
      expect(await session.get("shared/keep.txt")).toBeNull();
      await gatekeeper.rejectAction(queue.actions[1]!.id);
      expect(await bodyText(await session.get("shared/keep.txt"))).toBe("keep");
    } finally {
      session[Symbol.dispose]();
    }
  });

  it("isolates equal logical keys between account facets", async () => {
    const left = await openSession("account-left");
    const right = await openSession("account-right");
    try {
      await left.session.put("shared/value.txt", "left");
      await right.session.put("shared/value.txt", "right");
      await left.gatekeeper.applyAction(left.queue.actions[0]!.id);
      await right.gatekeeper.applyAction(right.queue.actions[0]!.id);

      expect(await bodyText(await left.session.get("shared/value.txt"))).toBe("left");
      expect(await bodyText(await right.session.get("shared/value.txt"))).toBe("right");
    } finally {
      left.session[Symbol.dispose]();
      right.session[Symbol.dispose]();
    }
  });

  it("rejects reserved keys and invalid page sizes before touching storage", async () => {
    const session = new R2SessionImpl({} as never, {} as never);
    await expect(session.get(".gatekeeper/staging/secret")).rejects.toThrow("cannot begin");
    await expect(session.list({ limit: 0 })).rejects.toThrow("1 through 1000");
  });
});
