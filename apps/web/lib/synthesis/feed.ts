/** Read model for the /insights feed: insights with their involved nodes resolved to chips. */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { insights, nodes } from "@/lib/db/schema";
import type { InsightKind, NodeType } from "@/lib/graph/constants";

export interface InsightView {
  id: string;
  kind: InsightKind;
  title: string;
  detail: Record<string, unknown>;
  nodes: { id: string; title: string; type: NodeType }[];
  createdAt: string;
}

export async function getInsights(): Promise<InsightView[]> {
  const rows = await db
    .select()
    .from(insights)
    .where(eq(insights.dismissed, false))
    .orderBy(desc(insights.createdAt));
  if (rows.length === 0) return [];

  const allIds = [...new Set(rows.flatMap((r) => r.nodeIds ?? []))];
  const nodeRows = allIds.length
    ? await db
        .select({ id: nodes.id, title: nodes.title, type: nodes.type })
        .from(nodes)
        .where(inArray(nodes.id, allIds))
    : [];
  const nodeById = new Map(nodeRows.map((n) => [n.id, n]));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    detail: r.detail ?? {},
    nodes: (r.nodeIds ?? [])
      .map((id) => nodeById.get(id))
      .filter((n): n is { id: string; title: string; type: NodeType } => Boolean(n)),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function dismissInsight(id: string): Promise<void> {
  await db.update(insights).set({ dismissed: true }).where(eq(insights.id, id));
}
