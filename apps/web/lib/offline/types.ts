/** Shared snapshot types for the on-device replica — safe to import on the client. */
import type { EdgeType, NodeType } from "@/lib/graph/constants";

export interface SnapshotNode {
  id: string;
  title: string;
  type: NodeType;
  summary: string | null;
  body: string | null;
  salience: number;
  confidence: number;
  status: string;
  clusterId: string | null;
  embedding: number[] | null;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  rationale: string | null;
}

export interface Snapshot {
  syncedAt: string;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  clusters: { id: string; label: string }[];
}
