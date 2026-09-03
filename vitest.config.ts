import path from "node:path";
import { defineConfig } from "vitest/config";

const serverOnlyMock = path.resolve(__dirname, "test/mocks/server-only.ts");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": serverOnlyMock,
    },
  },
  test: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": serverOnlyMock,
    },
    // P10 (audit): 3 tests (later found to vary run-to-run, up to 5) were
    // failing on vitest's default 5000ms timeout without being hung --
    // reproduced in isolation, all completed correctly in ~3-4s. The
    // deeper cause: vitest's default worker count is based on the
    // machine's reported CPU count, which in a shared/throttled sandbox
    // doesn't reflect real available compute, so CPU-heavier tests
    // (scanRepository's rule compilation) get starved unpredictably when
    // many workers run at once -- run-to-run failures varied in count and
    // which files failed, the signature of resource contention, not a
    // deterministic bug. Capping worker count gives every test a
    // consistent, fair share of CPU instead of an ever-larger timeout
    // chasing a moving target.
    maxWorkers: 4,
    testTimeout: 15_000,
    exclude: ["**/node_modules/**", "reference-ui/**"],
  },
});
