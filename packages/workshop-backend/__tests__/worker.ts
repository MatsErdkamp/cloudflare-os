export * from "../src/server.js";
export {default} from "../src/server.js";
export {GatekeeperHookLoopback} from "../src/server.js";
export {ContractLifecycleConformanceHost} from "./contract-lifecycle-conformance-host.js";

import {WorkerEntrypoint} from "cloudflare:workers";

const hookDisableCounts = new Map<string, number>();
const hookEnableCounts = new Map<string, number>();
const hookEnableStartedCounts = new Map<string, number>();
const hookEnableBlockers = new Map<string, {promise: Promise<void>; resolve: () => void}>();

/** Test-only reloadable hook endpoint used to exercise persisted hook lifecycle behavior. */
export class HookLifecycleTestTarget extends
    WorkerEntrypoint<Cloudflare.Env, {id: string}> {
  async enable(): Promise<void> {
    hookEnableStartedCounts.set(
        this.ctx.props.id, (hookEnableStartedCounts.get(this.ctx.props.id) ?? 0) + 1);
    await hookEnableBlockers.get(this.ctx.props.id)?.promise;
    hookEnableCounts.set(this.ctx.props.id, (hookEnableCounts.get(this.ctx.props.id) ?? 0) + 1);
  }

  pauseEnable(): void {
    let resolve!: () => void;
    let promise = new Promise<void>(done => { resolve = done; });
    hookEnableBlockers.set(this.ctx.props.id, {promise, resolve});
  }

  releaseEnable(): void {
    hookEnableBlockers.get(this.ctx.props.id)?.resolve();
    hookEnableBlockers.delete(this.ctx.props.id);
  }

  disable(): void {
    hookDisableCounts.set(this.ctx.props.id, (hookDisableCounts.get(this.ctx.props.id) ?? 0) + 1);
  }

  disabledCount(): number {
    return hookDisableCounts.get(this.ctx.props.id) ?? 0;
  }

  enabledCount(): number {
    return hookEnableCounts.get(this.ctx.props.id) ?? 0;
  }

  enableStartedCount(): number {
    return hookEnableStartedCounts.get(this.ctx.props.id) ?? 0;
  }
}
