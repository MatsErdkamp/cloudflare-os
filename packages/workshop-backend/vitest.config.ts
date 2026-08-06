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
          TEST_CONTRACT_HOST: { className: 'ContractRetractionTestHost', useSQLite: true },
        },
        kvNamespaces: ['BLUEPRINTS'],
        r2Buckets: ['BLUEPRINT_CONTENT'],
        workerLoaders: { TEST_LOADER: {}, LOADER: {} },
      },
    }),
  ],
  test: {
    include: ['__tests__/*.test.ts'],
  },
})
