import { defineConfig } from "vitest/config";

// Unit tests never touch the network or the real database: each test file gets its own in-memory SQLite.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: { DB_PATH: ":memory:", ADMIN_TOKEN: "test-admin-token", BUYER_PRIVATE_KEY: "", SPEND_CAP_USDC: "0.5", SPEND_CAP_WINDOW_MIN: "60" },
    testTimeout: 15_000,
  },
});
