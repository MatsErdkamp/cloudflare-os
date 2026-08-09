import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import capnwebValidate from 'capnweb-validate/vite'

// Tests run inside workerd (via vitest-pool-workers) so they exercise the same runtime APIs as
// production -- e.g. Uint8Array.toHex/fromHex and crypto.subtle used by the sharing module. Most
// tests import modules directly; the main Worker and a test-only SQLite DO binding support the
// Overseer cost-persistence integration test without loading the full deployment configuration.
export default defineConfig({
  plugins: [
    capnwebValidate(),
    cloudflareTest({
      main: './__tests__/worker.ts',
      miniflare: {
        compatibilityDate: '2026-02-02',
        compatibilityFlags: ['experimental', 'nodejs_compat', 'allow_irrevocable_stub_storage'],
        durableObjects: {
          TEST_OVERSEER: { className: 'OverseerDurableObject', useSQLite: true },
          TEST_CONTRACT_LIFECYCLE: { className: 'ContractLifecycleConformanceHost', useSQLite: true },
        },
        kvNamespaces: ['BLUEPRINTS'],
        r2Buckets: ['BLUEPRINT_CONTENT'],
        workerLoaders: { TEST_LOADER: {}, LOADER: {} },
        serviceBindings: {
          TEST_CONTRACT_SOURCE: { name: 'contract-source', entrypoint: 'ContractSource' },
        },
        workers: [{
          name: 'contract-source',
          modules: true,
          script: `
            import {RpcTarget, WorkerEntrypoint} from "cloudflare:workers";
            class Child extends RpcTarget {
              constructor(value) { super(); this.value = value; }
              read() { return this.value; }
            }
            class Source extends RpcTarget {
              read() { return "source"; }
              child() { return new Child("source-child"); }
              cursor() { return new Child("cursor"); }
              mappedChild() { return new Map([["child", new Child("mapped-child")]]); }
            }
            export class ContractSource extends WorkerEntrypoint {
              startSession() { return new Source(); }
            }
          `,
        }],
      },
    }),
  ],
  test: {
    include: ['__tests__/*.test.ts'],
  },
})
