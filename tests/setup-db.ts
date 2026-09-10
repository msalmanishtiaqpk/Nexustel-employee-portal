/**
 * Vitest global setup for database-backed tests: points Prisma at the test database and
 * applies migrations. Requires DATABASE_URL_TEST (falls back to DATABASE_URL).
 */
import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_TEST (or DATABASE_URL) must be set for integration tests");
  process.env.DATABASE_URL = url;
  process.env.FIELD_ENCRYPTION_KEY ??= "0".repeat(64);
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
