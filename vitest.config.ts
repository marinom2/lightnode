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
      // Modest floors that lock in current coverage (~56% lines, ~78% branches)
      // with a buffer so they aren't brittle. CI fails if a change drops below;
      // raise them as coverage improves.
      thresholds: {
        statements: 50,
        branches: 70,
        functions: 58,
        lines: 50,
      },
    },
  },
});
