/**
 * Read model for the node detail drawer (reused everywhere): the node (body decrypted
 * for the owner), its connections grouped-ready by edge type with rationales, its source
 * provenance, and its version history (for belief/trait/goal).
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { edges, nodes, nodeVersions } from "@/lib/db/schema";
import type { Node, NodeVersion } from "@/lib/db/schema";
import { maybeDecryptBody } from "@/lib/crypto";
import { VERSIONED_NODE_TYPES, type EdgeType, type NodeType } from "@/lib/graph/constants";

export interface ConnectionView {
  edgeId: string;
  type: EdgeType;
  weight: number;
  confidence: number;
  rationale: string | null;
  direction: "out" | "in";
  node: {
    id: string;
    title: string;
    type: NodeType;
    summary: string | null;
    confidence: number;
    salience: number;
    status: string;
  };
}

export interface NodeDetail {
  node: Omit<Node, "embedding">;
  bodyPlain: string | null;
  connections: ConnectionView[];
  versions: NodeVersion[];
  source: { id: string; title: string; type: NodeType } | null;
}

export async function getNodeDetail(id: string): Promise<NodeDetail | null> {
  const [node] = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
  if (!node) return null;

  const bodyPlain = await maybeDecryptBody(node.body);

  // outgoing + incoming edges with the neighbor node summary
  const outRows = await db
    .select({
      edgeId: edges.id,
      type: edges.type,
      weight: edges.weight,
      confidence: edges.confidence,
      rationale: edges.rationale,
      nId: nodes.id,
      nTitle: nodes.title,
      nType: nodes.type,
      nSummary: nodes.summary,
      nConfidence: nodes.confidence,
      nSalience: nodes.salience,
      nStatus: nodes.status,
    })
    .from(edges)
    .innerJoin(nodes, eq(edges.dst, nodes.id))
    .where(eq(edges.src, id));

  const inRows = await db
    .select({
      edgeId: edges.id,
      type: edges.type,
      weight: edges.weight,
      confidence: edges.confidence,
      rationale: edges.rationale,
      nId: nodes.id,
      nTitle: nodes.title,
      nType: nodes.type,
      nSummary: nodes.summary,
      nConfidence: nodes.confidence,
      nSalience: nodes.salience,
      nStatus: nodes.status,
    })
    .from(edges)
    .innerJoin(nodes, eq(edges.src, nodes.id))
    .where(eq(edges.dst, id));

  const toView = (r: (typeof outRows)[number], direction: "out" | "in"): ConnectionView => ({
    edgeId: r.edgeId,
    type: r.type,
    weight: r.weight,
    confidence: r.confidence,
    rationale: r.rationale,
    direction,
    node: {
      id: r.nId,
      title: r.nTitle,
      type: r.nType,
      summary: r.nSummary,
      confidence: r.nConfidence,
      salience: r.nSalience,
      status: r.nStatus,
    },
  });

  const connections = [
    ...outRows.map((r) => toView(r, "out")),
    ...inRows.map((r) => toView(r, "in")),
  ].sort((a, b) => b.weight - a.weight);

  const versions = VERSIONED_NODE_TYPES.includes(node.type)
    ? await db
        .select()
        .from(nodeVersions)
        .where(eq(nodeVersions.nodeId, id))
        .orderBy(desc(nodeVersions.at))
    : [];

  let source: NodeDetail["source"] = null;
  if (node.sourceId) {
    const [s] = await db
      .select({ id: nodes.id, title: nodes.title, type: nodes.type })
      .from(nodes)
      .where(eq(nodes.id, node.sourceId))
      .limit(1);
    source = s ?? null;
  }

  const { embedding: _drop, ...rest } = node;
  return { node: rest, bodyPlain, connections, versions, source };
}

/** Candidate picker for "add connection": title/trigram match, ranked by salience. */
export async function searchNodesForPicker(
  query: string,
  excludeId?: string,
  limit = 10,
): Promise<Array<{ id: string; title: string; type: NodeType; summary: string | null }>> {
  const q = query.trim();
  if (!q) return [];
  const rows = await db
    .select({ id: nodes.id, title: nodes.title, type: nodes.type, summary: nodes.summary })
    .from(nodes)
    .where(
      and(
        eq(nodes.status, "active"),
        excludeId ? sql`${nodes.id} <> ${excludeId}` : sql`true`,
        or(ilike(nodes.title, `%${q}%`), sql`${nodes.title} % ${q}`),
      ),
    )
    .orderBy(desc(nodes.salience))
    .limit(limit);
  return rows;
}
