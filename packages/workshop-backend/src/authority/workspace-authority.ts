import {collection, createTypedStorage} from "@gadgets/typed-storage";
import {
  validateBindingName,
  type BlueprintBindingAnnotation,
  type WorkpieceId,
} from "@gadgets/workshop-shared/api";

const LEGACY_MANAGER_SOURCE_SAMPLE_LIMIT = 16;
const legacyManagerSourceAccessBrand: unique symbol = Symbol("legacyManagerSourceAccess");

type WorkspaceAuthorityState = {
  state: "legacy";
  revision: number;
  nextEventSequence: number;
};

type WorkspaceAuthorityEvent = {
  sequence: number;
  type: "authorityModuleInitialized";
  revision: number;
};

type WorkspaceAuthorityEffect = {
  id: string;
  state: "pending" | "completed";
};

type LegacyManagerSourceUse = {
  chatId: number;
  gatekeeperId: WorkpieceId;
  observedAt: number;
};

type LegacyManagerSourceTelemetry = {
  totalUses: number;
  recentUses: LegacyManagerSourceUse[];
};

function makeAuthorityStorage(storage: DurableObjectStorage) {
  return createTypedStorage(storage, {
    singletons: {
      workspaceAuthorityState: <WorkspaceAuthorityState | undefined>undefined,
      legacyManagerSourceTelemetry: <LegacyManagerSourceTelemetry>{
        totalUses: 0,
        recentUses: [],
      },
    },
    collections: {
      workspaceAuthorityEvents: collection<WorkspaceAuthorityEvent>()({
        primaryKey: "sequence",
      }),
      workspaceAuthorityEffects: collection<WorkspaceAuthorityEffect>()({
        primaryKey: "id",
      }),
    },
  });
}

type AuthorityStorage = ReturnType<typeof makeAuthorityStorage>;

/** A closed mutation accepted by the in-process Workspace Authority module. */
export type WorkspaceAuthorityCommand = {type: "initialize"};

/** The result of a Workspace Authority mutation. */
export type WorkspaceAuthorityCommandResult = {
  type: "initialized";
  changed: boolean;
  revision: number;
};

/** A closed read accepted by the in-process Workspace Authority module. */
export type WorkspaceAuthorityQuery = {type: "status"};

/** A bounded operational view of the Workspace Authority module. */
export type WorkspaceAuthorityStatus = {
  state: "uninitialized" | "legacy";
  revision: number;
  eventHighWatermark: number;
  pendingEffects: number;
};

/** The result of one bounded reconciliation pass. */
export type WorkspaceAuthorityReconciliationResult = {attemptedEffects: number};

/**
 * The small in-process seam used by the Workspace aggregate host and its tests.
 *
 * Storage layout, event sequencing, effect records, migrations, and readiness transitions stay
 * inside the implementation. RPC adapters must translate into these closed commands and queries.
 */
export interface WorkspaceAuthority {
  execute(command: WorkspaceAuthorityCommand): WorkspaceAuthorityCommandResult;
  query(query: WorkspaceAuthorityQuery): WorkspaceAuthorityStatus;
  reconcile(): WorkspaceAuthorityReconciliationResult;
}

/** One legacy Gadget binding edge retained only until canonical Binding cutover. */
export type LegacyGadgetBindingRecord = {
  target: WorkpieceId;
  blueprintAnnotation?: BlueprintBindingAnnotation;
  pending?: {chatId: number; sequence?: number};
};

/** The minimum legacy Gadget record used by the compatibility adapter. */
export type LegacyGadgetAuthorityRecord = {
  id: WorkpieceId;
  title: string;
  bindings: Record<string, LegacyGadgetBindingRecord>;
};

/** Existing Workspace storage behavior required by the temporary Gadget compatibility adapter. */
export interface LegacyWorkspaceAuthorityAdapter<
  Gadget extends LegacyGadgetAuthorityRecord = LegacyGadgetAuthorityRecord,
> {
  getGadget(id: WorkpieceId): Gadget | undefined;
  listGadgets(): Iterable<Gadget>;
  putGadget(gadget: Gadget): void;
  hasContract(id: WorkpieceId): boolean;
  hasGatekeeper(id: WorkpieceId): boolean;
  bumpConsumers(ids: readonly WorkpieceId[]): void;
}

/** An opaque proof that the legacy Manager authoring path passed its rollout guard. */
export interface LegacyManagerSourceAccess {
  readonly gatekeeperId: WorkpieceId;
  readonly chatId: number;
  readonly [legacyManagerSourceAccessBrand]: true;
}

/** Bounded durable telemetry for the legacy Manager Source path. */
export type LegacyManagerSourceTelemetryView = Readonly<{
  totalUses: number;
  recentUses: readonly Readonly<LegacyManagerSourceUse>[];
}>;

/**
 * Temporary adapter for pre-cutover Gadget bindings and Manager authoring Sources.
 *
 * This interface is intentionally separate from {@link WorkspaceAuthority}; no Authority Session,
 * Consumer Environment, Task Template, Task Dispatch, or Agent Task adapter may receive it.
 */
export interface LegacyWorkspaceAuthorityCompatibility {
  queryVisibleBindings(request: {
    consumerId: WorkpieceId;
    forChatId?: number;
  }): [string, LegacyGadgetBindingRecord][];
  bindContract(request: {
    consumerId: WorkpieceId;
    name: string;
    contractId: WorkpieceId;
    chatId?: number;
  }): void;
  unbind(request: {consumerId: WorkpieceId; name: string; forChatId?: number}): void;
  renameBinding(request: {
    consumerId: WorkpieceId;
    oldName: string;
    newName: string;
  }): void;
  authorizeLegacyManagerSource(request: {
    surface: "managerAgentAuthoring";
    chatId: number;
    gatekeeperId: WorkpieceId;
  }): LegacyManagerSourceAccess;
  consumeLegacyManagerSourceAccess(access: LegacyManagerSourceAccess): Readonly<{
    chatId: number;
    gatekeeperId: WorkpieceId;
  }>;
  queryLegacyManagerSourceTelemetry(): LegacyManagerSourceTelemetryView;
}

/** Both deliberately disjoint interfaces implemented inside the Workspace aggregate. */
export type WorkspaceAuthorityModule = {
  authority: WorkspaceAuthority;
  compatibility: LegacyWorkspaceAuthorityCompatibility;
};

function status(storage: AuthorityStorage): WorkspaceAuthorityStatus {
  const state = storage.workspaceAuthorityState.get();
  let pendingEffects = 0;
  for (const effect of storage.workspaceAuthorityEffects.list()) {
    if (effect.state === "pending") pendingEffects++;
  }
  return {
    state: state?.state ?? "uninitialized",
    revision: state?.revision ?? 0,
    eventHighWatermark: state ? state.nextEventSequence - 1 : 0,
    pendingEffects,
  };
}

function requireGadget<Gadget extends LegacyGadgetAuthorityRecord>(
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
  id: WorkpieceId,
): Gadget {
  const gadget = adapter.getGadget(id);
  if (!gadget) throw new Error(`No such Gadget: ${id}`);
  return gadget;
}

function visibleBindings(
  gadget: LegacyGadgetAuthorityRecord,
  forChatId?: number,
): [string, LegacyGadgetBindingRecord][] {
  return Object.entries(gadget.bindings).filter(
    ([, edge]) => !edge.pending || edge.pending.chatId === forChatId,
  );
}

/** Creates the sole in-process Workspace Authority module over the existing Workspace storage. */
export function createWorkspaceAuthorityModule<
  Gadget extends LegacyGadgetAuthorityRecord = LegacyGadgetAuthorityRecord,
>(
  durableStorage: DurableObjectStorage,
  adapter: LegacyWorkspaceAuthorityAdapter<Gadget>,
): WorkspaceAuthorityModule {
  const storage = makeAuthorityStorage(durableStorage);
  const issuedLegacyManagerSourceAccess = new WeakSet<object>();

  const authority: WorkspaceAuthority = {
    execute(command) {
      switch (command.type) {
        case "initialize":
          return storage.transaction(() => {
            const current = storage.workspaceAuthorityState.get();
            if (current) {
              return {type: "initialized", changed: false, revision: current.revision};
            }
            const initial: WorkspaceAuthorityState = {
              state: "legacy",
              revision: 1,
              nextEventSequence: 2,
            };
            storage.workspaceAuthorityState.put(initial);
            storage.workspaceAuthorityEvents.put({
              sequence: 1,
              type: "authorityModuleInitialized",
              revision: initial.revision,
            });
            return {type: "initialized", changed: true, revision: initial.revision};
          });
      }
    },
    query(query) {
      switch (query.type) {
        case "status":
          return status(storage);
      }
    },
    reconcile() {
      return {attemptedEffects: status(storage).pendingEffects};
    },
  };

  const compatibility: LegacyWorkspaceAuthorityCompatibility = {
    queryVisibleBindings({consumerId, forChatId}) {
      return visibleBindings(requireGadget(adapter, consumerId), forChatId);
    },
    bindContract({consumerId, name, contractId, chatId}) {
      validateBindingName(name);
      if (name === "GADGET") throw new Error("The binding name `GADGET` is reserved.");
      const gadget = requireGadget(adapter, consumerId);
      const existing = gadget.bindings[name];
      if (existing) {
        if (existing.pending && existing.pending.chatId !== chatId) {
          throw new Error(`The binding name "${name}" is already proposed by another chat. ` +
            "Accept or revert that chat's changes first, or choose a different name.");
        }
        throw new Error(`There is already a binding named "${name}".`);
      }
      if (!adapter.hasContract(contractId)) {
        if (adapter.getGadget(contractId)) {
          throw new Error("Gadget-to-gadget bindings are not supported yet.");
        }
        if (adapter.hasGatekeeper(contractId)) {
          throw new Error("Gadgets can only bind installed Contracts, not raw Sources.");
        }
        throw new Error(`No such Contract: ${contractId}`);
      }
      for (const other of adapter.listGadgets()) {
        const placement = Object.entries(other.bindings).find(
          ([, edge]) => edge.target === contractId,
        );
        if (placement) {
          throw new Error(`Contract ${contractId} is already installed as ` +
            `${other.title}.${placement[0]}; create and approve a separate Contract instance ` +
            "for another binding placement.");
        }
      }
      gadget.bindings[name] = {
        target: contractId,
        ...(chatId === undefined ? {} : {pending: {chatId}}),
      };
      adapter.putGadget(gadget);
      adapter.bumpConsumers([consumerId]);
    },
    unbind({consumerId, name, forChatId}) {
      const gadget = requireGadget(adapter, consumerId);
      const edge = gadget.bindings[name];
      if (!edge || (edge.pending && edge.pending.chatId !== forChatId && forChatId !== undefined)) {
        throw new Error(`No such binding: ${name}`);
      }
      delete gadget.bindings[name];
      adapter.putGadget(gadget);
      adapter.bumpConsumers([consumerId]);
    },
    renameBinding({consumerId, oldName, newName}) {
      const gadget = requireGadget(adapter, consumerId);
      const edge = gadget.bindings[oldName];
      if (!edge) throw new Error(`No such binding: ${oldName}`);
      if (oldName === newName) return;
      validateBindingName(newName);
      if (newName === "GADGET") throw new Error("The binding name `GADGET` is reserved.");
      if (gadget.bindings[newName]) {
        throw new Error(`There is already a binding named "${newName}".`);
      }
      delete gadget.bindings[oldName];
      gadget.bindings[newName] = edge;
      adapter.putGadget(gadget);
      adapter.bumpConsumers([consumerId]);
    },
    authorizeLegacyManagerSource({surface, chatId, gatekeeperId}) {
      if (surface !== "managerAgentAuthoring") {
        throw new Error("Legacy Manager Sources are restricted to Manager agent authoring.");
      }
      if (!adapter.hasGatekeeper(gatekeeperId)) {
        throw new Error(`No such legacy Source: ${gatekeeperId}`);
      }
      const access: LegacyManagerSourceAccess = {
        gatekeeperId,
        chatId,
        [legacyManagerSourceAccessBrand]: true,
      };
      issuedLegacyManagerSourceAccess.add(access);
      return access;
    },
    consumeLegacyManagerSourceAccess(access) {
      if (!issuedLegacyManagerSourceAccess.delete(access)) {
        throw new Error("Legacy Manager Source access was forged, reused, or issued before restart.");
      }
      storage.transaction(() => {
        const current = storage.legacyManagerSourceTelemetry.get();
        const nextUse = {
          chatId: access.chatId,
          gatekeeperId: access.gatekeeperId,
          observedAt: Date.now(),
        };
        storage.legacyManagerSourceTelemetry.put({
          totalUses: Math.min(Number.MAX_SAFE_INTEGER, current.totalUses + 1),
          recentUses: [...current.recentUses, nextUse].slice(-LEGACY_MANAGER_SOURCE_SAMPLE_LIMIT),
        });
      });
      return {
        gatekeeperId: access.gatekeeperId,
        chatId: access.chatId,
      };
    },
    queryLegacyManagerSourceTelemetry() {
      const telemetry = storage.legacyManagerSourceTelemetry.get();
      return structuredClone(telemetry);
    },
  };

  return {authority, compatibility};
}
