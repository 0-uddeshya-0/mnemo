import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Fast, hermetic unit tests for the security-critical invariants (no DB, no network).
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Deterministic secrets so crypto can derive a key without a real .env.
    env: { MNEMOSYNE_PASSWORD: "vitest-fixed-password", SESSION_SECRET: "vitest-session-secret", NODE_ENV: "test" },
    // crypto tests derive an argon2id key, which is intentionally slow.
    testTimeout: 20_000,
  },
});
