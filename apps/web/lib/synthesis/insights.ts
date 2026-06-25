/**
 * Insight bookkeeping for the synthesis engine. Regenerable kinds (cluster/gap/dormant/
 * contradiction) are cleared and recomputed each run; `evolution` insights are created by
 * the pipeline and persist. Dismissed insights never recur for the same node-set.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { insights } from "@/lib/db/schema";
import type { InsightKind } from "@/lib/graph/constants";

export async function clearRegenerableInsights(): Promise<void> {
  await db
    .delete(insights)
    .where(and(eq(insights.dismissed, false), sql`kind = any(array['cluster','gap','dormant','contradiction'])`));
}

export async function createInsightIfNew(
  kind: InsightKind,
  title: string,
  detail: Record<string, unknown>,
  nodeIds: string[],
): Promise<boolean> {
  const key = [...nodeIds].sort().join(",");
  const dismissedRows = await db
    .select({ nodeIds: insights.nodeIds })
    .from(insights)
    .where(and(eq(insights.kind, kind), eq(insights.dismissed, true)));
  if (dismissedRows.some((r) => [...(r.nodeIds ?? [])].sort().join(",") === key)) {
    return false;
  }
  await db.insert(insights).values({ kind, title, detail, nodeIds });
  return true;
}
