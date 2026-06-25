/**
 * Wipe ALL knowledge (nodes, edges, chunks, versions, clusters, insights, activity, jobs,
 * interview progress) — a clean "start over" so the graph holds only you. Keeps the schema,
 * your API keys, and settings.
 *
 *   pnpm db:reset
 */
import "@/lib/server/load-env";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main() {
  // nodes cascade clears edges / chunks / node_versions / activity_log.
  await db.execute(sql`truncate table nodes restart identity cascade`);
  await db.execute(
    sql`truncate table clusters, insights, interview_state, ingest_jobs restart identity cascade`,
  );
  console.log("✓ Cleared. Your brain is empty — open /onboarding to begin building the real you.");
  process.exit(0);
}

main().catch((err) => {
  console.error("reset failed:", err);
  process.exit(1);
});
