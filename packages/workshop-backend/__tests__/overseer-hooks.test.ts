import { describe, expect, it, vi } from "vitest";
import { RpcStub as NativeRpcStub } from "cloudflare:workers";
import { DEFAULT_ADMIN_CONFIG, serializeAdminConfig } from "../src/admin-config.js";
import { OverseerDurableObject } from "../src/overseer.js";

vi.mock("capnweb-validate", () => ({ validateRpc: () => () => undefined }));

function makeOverseer(
    getConfig: () => Promise<string | null>,
    hook: { enabled: boolean; vendorId?: string; callback?: object } | null =
        { enabled: true, vendorId: "email" },
    legacyVendorId?: string,
): OverseerDurableObject {
  let overseer = Object.create(OverseerDurableObject.prototype) as OverseerDurableObject;
  Object.assign(overseer, {
    env: { BLUEPRINTS: { get: getConfig } },
    impl: {
      storage: {
        boundHooks: { get: () => hook && ({ ...hook, gatekeeperId: 1 }) },
        gatekeepers: {
          get: () => legacyVendorId && {
            creationSpec: {
              type: "gatekeeper",
              vendorId: legacyVendorId,
              resourceUrl: "https://example.com",
              typeUrlPattern: "https://*",
            },
          },
        },
      },
    },
  });
  return overseer;
}

describe("OverseerDurableObject.startHook", () => {
  it.each([
    ["ordinary", DEFAULT_ADMIN_CONFIG, "email"],
    ["ambient", {
      ...DEFAULT_ADMIN_CONFIG,
      ambientGatekeeperModes: { scheduler: "optional" as const },
    }, "scheduler"],
  ])("allows delivery for an enabled %s vendor", async (_kind, config, vendorId) => {
    let callback = {};
    let overseer = makeOverseer(
        async () => serializeAdminConfig(config), { enabled: true, vendorId, callback });

    await expect(overseer.startHook(1)).resolves.toMatchObject({ callback });
  });

  it("rejects delivery for an administratively disabled ordinary vendor", async () => {
    let config = { ...DEFAULT_ADMIN_CONFIG, disabledGatekeepers: ["email"] };
    let overseer = makeOverseer(async () => serializeAdminConfig(config));

    await expect(overseer.startHook(1)).rejects.toThrow("Gatekeeper is disabled.");
  });

  it("rejects delivery for an administratively disabled ambient vendor", async () => {
    let config = {
      ...DEFAULT_ADMIN_CONFIG,
      ambientGatekeeperModes: { scheduler: "disabled" as const },
    };
    let overseer = makeOverseer(
        async () => serializeAdminConfig(config), { enabled: true, vendorId: "scheduler" });

    await expect(overseer.startHook(1)).rejects.toThrow("Gatekeeper is disabled.");
  });

  it("enforces vendor policy for legacy hooks without a denormalized vendor ID", async () => {
    let config = { ...DEFAULT_ADMIN_CONFIG, disabledGatekeepers: ["email"] };
    let overseer = makeOverseer(
        async () => serializeAdminConfig(config), { enabled: true }, "email");

    await expect(overseer.startHook(1)).rejects.toThrow("Gatekeeper is disabled.");
  });

  it("rejects delivery when admin-config KV access fails", async () => {
    let overseer = makeOverseer(async () => { throw new Error("KV unavailable"); });

    await expect(overseer.startHook(1)).rejects.toThrow("KV unavailable");
  });

  it("rejects delivery when the hook was disabled", async () => {
    let overseer = makeOverseer(
        async () => serializeAdminConfig(DEFAULT_ADMIN_CONFIG),
        { enabled: false, vendorId: "email" });

    await expect(overseer.startHook(1)).rejects.toThrow("Hook has been deleted or disabled.");
  });

  it("rejects delivery when the hook was deleted", async () => {
    let overseer = makeOverseer(
        async () => serializeAdminConfig(DEFAULT_ADMIN_CONFIG), null);

    await expect(overseer.startHook(1)).rejects.toThrow("Hook has been deleted or disabled.");
  });

  it("routes Contract-owned hook activity through the preapproved Contract Source queue", async () => {
    let authorizeContractObservation = vi.fn(async () => {});
    let callback = {};
    let overseer = Object.create(OverseerDurableObject.prototype) as OverseerDurableObject;
    Object.assign(overseer, {
      env: {BLUEPRINTS: {get: async () => serializeAdminConfig(DEFAULT_ADMIN_CONFIG)}},
      impl: {
        requireContract: () => ({id: 9, artifactHash: "sha256:artifact"}),
        authorizeContractObservation,
        storage: {
          boundHooks: {get: () => ({
            enabled: true,
            gatekeeperId: 2,
            contractId: 9,
            vendorId: "email",
            callback,
          })},
          gatekeepers: {get: () => ({creationSpec: {type: "gatekeeper", vendorId: "email"}})},
        },
      },
    });

    let session = await overseer.startHook(1);
    let description = {title: "Received email", description: "Private Source event"};
    await session.approvalQueue.authorizeObservation(description);

    expect(session.callback).toBe(callback);
    expect(authorizeContractObservation).toHaveBeenCalledWith(
      expect.objectContaining({contractId: 9, sourceGatekeeperId: 2, caller: {from: "hook"}}),
      description,
    );
  });
});

async function makeTargetOverseer(gadgetId?: number, pendingContractChild = false) {
  let controllerEnable = vi.fn(async (_initiator: object, _target: object) => {});
  let record = {
    id: 4,
    actionId: 12,
    gatekeeperId: 1,
    gadgetId,
    controller: {enable: controllerEnable},
    callback: {},
    description: {title: "Incoming email", description: "Receives email"},
    enabled: false,
  };
  let overseer = {
    open: OverseerDurableObject.prototype.open,
    impl: {
      ownerId: "user-id",
      ensureAmbientCapsules: async () => {},
      markOutputsDirty: () => {},
      joinPresence: () => () => {},
      joinOutputsFanout: () => () => {},
      users: {
        idFromString: (id: string) => id,
        get: () => ({
          whoami: async () => ({id: "profile-id", name: "Test User"}),
        }),
      },
      ctx: {
        id: {toString: () => "workspace-id"},
        exports: {GatekeeperHookLoopback: ({props}: {props: object}) => props},
      },
      storage: {
        prohibitAllSharing: {get: () => false},
        boundHooks: {get: () => record, list: () => [record], put: vi.fn()},
        actions: {get: () => pendingContractChild ? {
          id: 12,
          type: "bindHook",
          state: "pending",
          contractAttribution: {contractOperationId: "operation-1"},
        } : undefined, put: vi.fn()},
      },
    },
  } satisfies Pick<OverseerDurableObject, "open"> & {impl: object};
  let notifyClosed = new NativeRpcStub<() => void>(() => {});
  let client = await overseer.open("user-id", "profile-id", notifyClosed);
  return {client, controllerEnable};
}

describe("hook target", () => {

  it("passes the workspace and gadget IDs to enable()", async () => {
    let {client, controllerEnable} = await makeTargetOverseer(17);

    await client.enableHook(4);

    expect(controllerEnable).toHaveBeenCalledTimes(1);
    expect(controllerEnable.mock.calls[0][1]).toEqual({workspaceId: "workspace-id", gadgetId: 17});
  });

  it("omits the gadget ID for a hook that is not pinned to one", async () => {
    let {client, controllerEnable} = await makeTargetOverseer();

    await client.enableHook(4);

    expect(controllerEnable.mock.calls[0][1]).toEqual({workspaceId: "workspace-id"});
  });

  it("does not allow a staged Contract hook to bypass its parent operation", async () => {
    let {client, controllerEnable} = await makeTargetOverseer(17, true);

    await expect(client.enableHook(4)).rejects.toThrow("parent operation");
    expect(controllerEnable).not.toHaveBeenCalled();
    await expect(client.listHooks()).resolves.toEqual([]);
  });

});
