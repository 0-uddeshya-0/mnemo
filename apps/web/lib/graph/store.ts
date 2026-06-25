/**
 * The graph "write/read" core used by the pipeline, search, UI server actions, and MCP.
 * Centralizes: node create/merge (cosine + title dedupe), edge upsert (dedupe on
 * src/dst/type), nearest-neighbor vector search, versioning, and activity logging.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, toPgArray, toVectorLiteral } from "@/lib/db";
import { activityLog, edges, nodeVersions, nodes } from "@/lib/db/schema";
import type { Node } from "@/lib/db/schema";
import { maybeEncryptBody } from "@/lib/crypto";
import { activeEmbedProvider } from "@/lib/embeddings";
import type { Actor, EdgeType, NodeType, Sensitivity } from "@/lib/graph/constants";

// ── Activity log ────────────────────────────────────────────────────────────
export async function recordActivity(input: {
  action: string;
  nodeId?: string | null;
  actor: Actor;
  actorKeyId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(activityLog).values({
    action: input.action,
    nodeId: input.nodeId ?? null,
    actor: input.actor,
    actorKeyId: input.actorKeyId ?? null,
    detail: input.detail ?? {},
  });
}

// ── Nearest neighbors (vector kNN) ──────────────────────────────────────────
export interface Neighbor {
  id: string;
  title: string;
  type: NodeType;
  summary: string | null;
  cosine: number;
}

export async function nearestNodes(
  embedding: number[],
  opts: { k?: number; minCosine?: number; excludeIds?: string[]; types?: NodeType[] } = {},
): Promise<Neighbor[]> {
  const { k = 8, minCosine = 0, excludeIds = [], types } = opts;
  const lit = toVectorLiteral(embedding);
  const conds = [sql`embedding is not null`, sql`status = 'active'`];
  if (excludeIds.length) conds.push(sql`not (id = any(${toPgArray(excludeIds)}::uuid[]))`);
  if (types && types.length) conds.push(sql`type = any(${toPgArray(types)}::text[])`);
  const where = sql.join(conds, sql` and `);

  const rows = (await db.execute(sql`
    select id, title, type, summary, 1 - (embedding <=> ${lit}::vector) as cosine
    from nodes
    where ${where}
    order by embedding <=> ${lit}::vector
    limit ${k}
  `)) as unknown as Array<{
    id: string;
    title: string;
    type: NodeType;
    summary: string | null;
    cosine: number;
  }>;

  return rows
    .map((r) => ({ ...r, cosine: Number(r.cosine) }))
    .filter((r) => r.cosine >= minCosine);
}

// ── Node create / merge ─────────────────────────────────────────────────────
export interface AtomInput {
  type: NodeType;
  title: string;
  body?: string | null;
  summary?: string | null;
  properties?: Record<string, unknown>;
  confidence?: number;
  salience?: number;
  sensitivity?: Sensitivity;
  sourceId?: string | null;
  embedding?: number[] | null;
}

export async function getNode(id: string): Promise<Node | undefined> {
  const [row] = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
  return row;
}

/** Insert a node (encrypting the body if private, tagging the embed provider). */
export async function createNode(input: AtomInput, actor: Actor = "owner"): Promise<string> {
  const sensitivity = input.sensitivity ?? "normal";
  const body = await maybeEncryptBody(input.body ?? null, sensitivity);
  const [row] = await db
    .insert(nodes)
    .values({
      type: input.type,
      title: input.title,
      body,
      summary: input.summary ?? null,
      properties: input.properties ?? {},
      confidence: input.confidence ?? 1,
      salience: input.salience ?? 0.5,
      sensitivity,
      sourceId: input.sourceId ?? null,
      embedding: input.embedding ?? null,
      embedProvider: activeEmbedProvider(),
    })
    .returning({ id: nodes.id });
  if (!row) throw new Error("createNode: insert returned no row");
  await recordActivity({
    action: "create_node",
    nodeId: row.id,
    actor,
    detail: { type: input.type, title: input.title },
  });
  return row.id;
}

/**
 * Dedupe-aware atom upsert (Stage 4): exact title (same type, case-insensitive) OR
 * cosine ≥ 0.92 (same type) → MERGE (union properties, keep highest confidence, keep
 * provenance) instead of duplicating. Otherwise insert.
 */
export async function mergeOrInsertAtom(
  atom: AtomInput,
  actor: Actor = "llm",
): Promise<{ id: string; merged: boolean }> {
  // 1) exact title (case-insensitive), same type, active
  const [titleMatch] = await db
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.type, atom.type),
        eq(nodes.status, "active"),
        sql`lower(${nodes.title}) = lower(${atom.title})`,
      ),
    )
    .limit(1);

  let match: Node | undefined = titleMatch;

  // 2) cosine ≥ 0.92, same type
  if (!match && atom.embedding) {
    const near = await nearestNodes(atom.embedding, {
      k: 1,
      minCosine: 0.92,
      types: [atom.type],
    });
    if (near[0]) match = await getNode(near[0].id);
  }

  if (match) {
    const mergedProps = { ...(match.properties ?? {}), ...(atom.properties ?? {}) };
    await db
      .update(nodes)
      .set({
        properties: mergedProps,
        confidence: Math.max(match.confidence, atom.confidence ?? 0.7),
        summary: match.summary ?? atom.summary ?? null,
        sourceId: match.sourceId ?? atom.sourceId ?? null,
        salience: Math.min(1, match.salience + 0.05),
      })
      .where(eq(nodes.id, match.id));
    await recordActivity({
      action: "merge_node",
      nodeId: match.id,
      actor,
      detail: { title: atom.title, type: atom.type },
    });
    return { id: match.id, merged: true };
  }

  const id = await createNode(atom, actor);
  return { id, merged: false };
}

// ── Edges ───────────────────────────────────────────────────────────────────
export interface EdgeInput {
  src: string;
  dst: string;
  type: EdgeType;
  weight?: number;
  confidence?: number;
  rationale?: string | null;
}

/** Upsert a directed edge, deduped on (src,dst,type). Keeps the stronger weight. */
export async function upsertEdge(e: EdgeInput): Promise<void> {
  if (e.src === e.dst) return; // no self-loops
  await db
    .insert(edges)
    .values({
      src: e.src,
      dst: e.dst,
      type: e.type,
      weight: e.weight ?? 0.5,
      confidence: e.confidence ?? 1,
      rationale: e.rationale ?? null,
    })
    .onConflictDoUpdate({
      target: [edges.src, edges.dst, edges.type],
      set: {
        weight: sql`greatest(${edges.weight}, excluded.weight)`,
        confidence: sql`greatest(${edges.confidence}, excluded.confidence)`,
        rationale: sql`coalesce(excluded.rationale, ${edges.rationale})`,
      },
    });
}

// ── Versioning (belief/trait/goal history) ──────────────────────────────────
export async function snapshotNodeVersion(
  node: Node,
  reason: string,
): Promise<void> {
  await db.insert(nodeVersions).values({
    nodeId: node.id,
    snapshot: {
      title: node.title,
      body: node.body,
      summary: node.summary,
      properties: node.properties,
      confidence: node.confidence,
      status: node.status,
    },
    reason,
  });
}

// ── Degree (for salience) ───────────────────────────────────────────────────
async function nodeDegree(id: string): Promise<number> {
  const rows = (await db.execute(sql`
    select count(*)::int as degree from edges where src = ${id} or dst = ${id}
  `)) as unknown as Array<{ degree: number }>;
  return rows[0]?.degree ?? 0;
}

/** Stage 6 salience: sigmoid(0.15*degree + 0.3*revisits + 0.2*owner_asserted). */
export async function reconcileSalience(id: string): Promise<void> {
  const node = await getNode(id);
  if (!node) return;
  const degree = await nodeDegree(id);
  const revisits = Number((node.properties as Record<string, unknown>)?.revisits ?? 0);
  const ownerAsserted = node.confidence >= 0.999 ? 1 : 0;
  const x = 0.15 * degree + 0.3 * revisits + 0.2 * ownerAsserted - 1.0;
  const salience = 1 / (1 + Math.exp(-x));
  await db.update(nodes).set({ salience }).where(eq(nodes.id, id));
}
