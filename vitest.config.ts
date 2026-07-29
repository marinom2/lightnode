import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Scope coverage to the pure-logic surface the unit tests target: the SDK
      // and the lib/ helpers. The Next.js pages/components are exercised by the
      // Playwright e2e suite, not these unit tests, so including them would
      // report a misleading single-digit number.
      include: ["sdk/src/**/*.ts", "lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "sdk/dist/**"],
      // Modest floors that lock in current coverage with a buffer so they aren't
      // brittle. CI fails if a change drops below; raise them as coverage
      // improves.
      //
      // RECALIBRATED for @vitest/coverage-v8 v4. The previous floors (50/70/58/
      // 50, described as "~56% lines, ~78% branches") were measured under
      // coverage-v8 v2, which mapped V8 output through `v8-to-istanbul`. v3
      // replaced that with AST-aware remapping (`ast-v8-to-istanbul`), and the
      // dependabot bump in 09c625b took this repo v2 -> v4 in one step. The
      // remapper attributes branches in never-executed files far more
      // completely, so the same suite that reported ~78% branches now reports
      // ~42%. Nothing about the tests changed - only the measurement did, and
      // the old numbers are not comparable to the new ones.
      //
      // These are the honest v4 numbers for the current suite (47.9 stmts /
      // 41.9 branches / 51.3 funcs / 49.4 lines), floored with ~1pt of slack.
      // The big uncovered surfaces are sdk/src/cli.ts, worker.ts, lib/tauri.ts
      // and lib/use-encrypted-inference.ts, all at ~0%; covering those is the
      // way to raise these, not lowering them further.
      thresholds: {
        statements: 47,
        branches: 40,
        functions: 50,
        lines: 48,
      },
    },
  },
});
