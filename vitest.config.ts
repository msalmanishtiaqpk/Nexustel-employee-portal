import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv();
const testUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    globalSetup: ["tests/setup-db.ts"],
    env: { DATABASE_URL: testUrl ?? "", FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY ?? "0".repeat(64), JOB_SECRET: "test" },
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside a React Server environment; it is a compile-time guard we don't need in tests.
      "server-only": path.resolve(__dirname, "tests/empty-module.ts"),
    },
  },
});
