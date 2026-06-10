import { defineConfig } from "vitest/config";

// Keyring/vault crypto runs under Node's global WebCrypto (node 18+), so no jsdom needed.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
