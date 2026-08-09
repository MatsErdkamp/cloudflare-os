import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    capnwebValidate(),
    cloudflareTest({
      main: "./src/worker.ts",
      miniflare: {
        compatibilityDate: "2026-07-02",
        compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_als"],
        durableObjects: {
          TEST_R2_GATEKEEPER: { className: "R2Gatekeeper", useSQLite: true },
          TEST_R2_AUTHORITY: {className: "R2Authority", useSQLite: true},
          TEST_R2_ACCOUNT_STATE: {className: "R2AccountState", useSQLite: true},
        },
        r2Buckets: ["STORAGE"],
      },
    }),
  ],
  test: { include: ["__tests__/*.test.ts"] },
});
