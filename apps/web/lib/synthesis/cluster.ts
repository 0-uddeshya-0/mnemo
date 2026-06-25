/**
 * Community detection (Louvain) over the weighted edge graph → theme clusters. the LLM
 * labels each community; clusters persist and color/group the graph + answer "my themes".
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { z } from "zod";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, edges, nodes } from "@/lib/db/schema";
import { completeJSON } from "@/lib/llm";
import { createInsightIfNew } from "@/lib/synthesis/insights";

export interface ClusterResult {
  id: string;
  label: string;
  memberIds: string[];
}

const MIN_CLUSTER_SIZE = 3;

export async function runClustering(): Promise<ClusterResult[]> {
  const nodeRows = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.status, "active"));
  if (nodeRows.length < 4) {
    await resetClusters();
    return [];
  }

  const idSet = new Set(nodeRows.map((n) => n.id));
  const edgeRows = await db
    .select({ src: edges.src, dst: edges.dst, weight: edges.weight })
    .from(edges);

  const g = new Graph({ type: "undirected" });
  for (const n of nodeRows) g.addNode(n.id);
  for (const e of edgeRows) {
    if (e.src === e.dst || !idSet.has(e.src) || !idSet.has(e.dst)) continue;
    if (g.hasEdge(e.src, e.dst)) {
      g.updateEdgeAttribute(e.src, e.dst, "weight", (w) => (Number(w) || 0) + e.weight);
    } else {
      g.addEdge(e.src, e.dst, { weight: e.weight });
    }
  }
  if (g.size === 0) {
    await resetClusters();
    return [];
  }

  const { communities } = louvain.detailed(g, { getEdgeWeight: "weight" });
  const groups = new Map<number, string[]>();
  for (const [id, c] of Object.entries(communities)) {
    const arr = groups.get(c);
    if (arr) arr.push(id);
    else groups.set(c, [id]);
  }

  await resetClusters();

  const results: ClusterResult[] = [];
  for (const [, ids] of groups) {
    if (ids.length < MIN_CLUSTER_SIZE) continue;
    const members = await db
      .select({ id: nodes.id, title: nodes.title, type: nodes.type })
      .from(nodes)
      .where(inArray(nodes.id, ids))
      .orderBy(desc(nodes.salience))
      .limit(20);

    const info = await completeJSON({
      schema: z.object({
        label: z.string(),
        summary: z.string(),
        keywords: z.array(z.string()).default([]),
      }),
      system:
        "You name and summarize a thematic cluster in one person's mind. Return a short evocative " +
        "label (2–4 words), a one-sentence summary, and 3–6 keywords.",
      prompt: members.map((m) => `- (${m.type}) ${m.title}`).join("\n"),
      model: "fast",
      maxTokens: 400,
    });

    const [cluster] = await db
      .insert(clusters)
      .values({ label: info.label, summary: info.summary, keywords: info.keywords, size: ids.length })
      .returning({ id: clusters.id });
    if (!cluster) continue;

    await db.update(nodes).set({ clusterId: cluster.id }).where(inArray(nodes.id, ids));
    await createInsightIfNew(
      "cluster",
      `Theme: ${info.label}`,
      { summary: info.summary, keywords: info.keywords, size: ids.length },
      ids.slice(0, 12),
    );
    results.push({ id: cluster.id, label: info.label, memberIds: ids });
  }
  return results;
}

async function resetClusters(): Promise<void> {
  await db.update(nodes).set({ clusterId: null }).where(sql`cluster_id is not null`);
  await db.delete(clusters);
}
