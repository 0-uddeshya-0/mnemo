/**
 * Server side of the on-device replica (Phase B): build a compact snapshot of the active
 * graph that a device caches in IndexedDB for fully-offline read + search. Embeddings are
 * included so semantic search works offline; private-node bodies are excluded (their
 * decryption key never leaves the server), summaries/titles are kept.
 */
import { ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, edges, nodes } from "@/lib/db/schema";
import type { Snapshot } from "@/lib/offline/types";

export async function buildSnapshot(): Promise<Snapshot> {
  const nodeRows = await db
    .select({
      id: nodes.id,
      title: nodes.title,
      type: nodes.type,
      summary: nodes.summary,
      body: nodes.body,
      sensitivity: nodes.sensitivity,
      salience: nodes.salience,
      confidence: nodes.confidence,
      status: nodes.status,
      clusterId: nodes.clusterId,
      embedding: nodes.embedding,
    })
    .from(nodes)
    .where(ne(nodes.status, "archived"));

  const edgeRows = await db
    .select({
      id: edges.id,
      source: edges.src,
      target: edges.dst,
      type: edges.type,
      weight: edges.weight,
      rationale: edges.rationale,
    })
    .from(edges);

  const clusterRows = await db.select({ id: clusters.id, label: clusters.label }).from(clusters);

  return {
    syncedAt: new Date().toISOString(),
    nodes: nodeRows.map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      summary: n.summary,
      body: n.sensitivity === "private" ? null : n.body,
      salience: n.salience,
      confidence: n.confidence,
      status: n.status,
      clusterId: n.clusterId,
      embedding: n.embedding ?? null,
    })),
    edges: edgeRows,
    clusters: clusterRows,
  };
}
