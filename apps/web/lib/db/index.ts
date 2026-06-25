/**
 * Drizzle client over postgres.js. A single pooled connection is reused across hot
 * reloads in dev (stashed on globalThis) to avoid exhausting Postgres connections.
 *
 * Imported by both the Next server runtime and standalone tsx entrypoints (worker,
 * MCP server, seed), so it must stay free of `next/*` and `server-only`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

const globalForDb = globalThis as unknown as {
  _pg?: ReturnType<typeof postgres>;
};

const client =
  globalForDb._pg ??
  postgres(env.DATABASE_URL, {
    max: 10,
    // pgvector / generated columns work fine with the default protocol.
    onnotice: () => {},
  });

if (env.NODE_ENV !== "production") globalForDb._pg = client;

export const db = drizzle(client, { schema });
export const pg = client;
export { schema };

/**
 * Format a number[] as a pgvector literal for raw SQL kNN queries, e.g.
 *   sql`embedding <=> ${toVectorLiteral(vec)}::vector`
 */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Build a Postgres array literal (e.g. `{"a","b"}`) for use as a SINGLE bound param,
 * cast with `::uuid[]` / `::text[]`. drizzle otherwise expands a JS array into a record
 * `($1,$2,…)` which cannot be cast to an array type. Elements are quoted + escaped.
 */
export function toPgArray(values: readonly string[]): string {
  return `{${values
    .map((v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")}}`;
}
