import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is used for `generate` (diffing schema.ts into incremental SQL) only.
 * The authoritative initial migration is the hand-authored drizzle/0000_init.sql,
 * which `pnpm db:migrate` applies. Generated migrations land alongside it.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mnemosyne:mnemosyne@localhost:5432/mnemosyne",
  },
  strict: true,
  verbose: true,
});
