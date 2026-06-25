/**
 * Graph read model for the force-directed explorer. Returns lightweight node + link
 * arrays (no bodies/embeddings) plus cluster labels, honoring the explorer filters.
 */
import { and, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, edges, nodes } from "@/lib/db/schema";
import { toPgArray } from "@/lib/db";
import type { EdgeType, NodeType } from "@/lib/graph/constants";

export interface GraphNode {
  id: string;
  title: string;
  type: NodeType;
  salience: number;
  confidence: number;
  status: string;
  clusterId: string | null;
}

export interface GraphLink {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  confidence: number;
  rationale: string | null;
}

export interface GraphCluster {
  id: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  clusters: GraphCluster[];
}

export interface GraphFilters {
  types?: NodeType[];
  edgeTypes?: EdgeType[];
  minConfidence?: number;
  includeSuperseded?: boolean;
  since?: string | null;
}

export async function getGraphData(filters: GraphFilters = {}): Promise<GraphData> {
  const minConfidence = filters.minConfidence ?? 0;
  const includeSuperseded = filters.includeSuperseded ?? false;

  const nodeConds = [
    includeSuperseded
      ? sql`status in ('active','superseded')`
      : sql`status = 'active'`,
    gte(nodes.confidence, minConfidence),
  ];
  if (filters.types?.length) {
    nodeConds.push(sql`type = any(${toPgArray(filters.types)}::text[])`);
  }
  if (filters.since) {
    nodeConds.push(sql`created_at >= ${filters.since}`);
  }

  const nodeRows = await db
    .select({
      id: nodes.id,
      title: nodes.title,
      type: nodes.type,
      salience: nodes.salience,
      confidence: nodes.confidence,
      status: nodes.status,
      clusterId: nodes.clusterId,
    })
    .from(nodes)
    .where(and(...nodeConds));

  const nodeIds = new Set(nodeRows.map((n) => n.id));

  const edgeConds = [gte(edges.confidence, minConfidence)];
  if (filters.edgeTypes?.length) {
    edgeConds.push(sql`type = any(${toPgArray(filters.edgeTypes)}::text[])`);
  }
  const edgeRows = await db
    .select({
      id: edges.id,
      source: edges.src,
      target: edges.dst,
      type: edges.type,
      weight: edges.weight,
      confidence: edges.confidence,
      rationale: edges.rationale,
    })
    .from(edges)
    .where(and(...edgeConds));

  // Keep only edges whose endpoints survived node filtering.
  const links = edgeRows.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  const clusterRows = await db.select({ id: clusters.id, label: clusters.label }).from(clusters);

  return {
    nodes: nodeRows.map((n) => ({
      ...n,
      salience: Number(n.salience),
      confidence: Number(n.confidence),
    })),
    links: links.map((l) => ({ ...l, weight: Number(l.weight), confidence: Number(l.confidence) })),
    clusters: clusterRows,
  };
}
