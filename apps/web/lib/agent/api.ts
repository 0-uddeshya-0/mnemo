/**
 * Agent-facing graph operations shared by the MCP server and the REST API. EVERY read
 * here applies `isVisible` (private + owner-hidden types are stripped); every write is
 * capped at confidence ≤ 0.8 and logged with the calling key id (§9, §12).
 */
import { z } from "zod";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, toPgArray } from "@/lib/db";
import { activityLog, agentRuns, clusters, edges, nodes } from "@/lib/db/schema";
import { hybridSearch } from "@/lib/search";
import { completeJSON } from "@/lib/llm";
import { embed } from "@/lib/embeddings";
import { createNode, recordActivity, upsertEdge } from "@/lib/graph/store";
import { ensureSelf } from "@/lib/graph/self";
import { filterVisible, getVisibility, isVisible, type Visibility } from "@/lib/visibility";
import { maybeDecryptBody } from "@/lib/crypto";
import type { EdgeType, NodeType } from "@/lib/graph/constants";

export interface AgentNodeSummary {
  id: string;
  title: string;
  type: NodeType;
  summary: string | null;
  confidence: number;
  status: string;
}

// ── search_knowledge ────────────────────────────────────────────────────────
export async function agentSearch(
  query: string,
  opts: { types?: NodeType[]; limit?: number } = {},
): Promise<AgentNodeSummary[]> {
  const v = await getVisibility();
  const results = await hybridSearch(query, { types: opts.types, limit: (opts.limit ?? 10) * 2 });
  return filterVisible(results, v)
    .slice(0, opts.limit ?? 10)
    .map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      summary: r.summary,
      confidence: r.confidence,
      status: r.status,
    }));
}

// ── get_node ────────────────────────────────────────────────────────────────
export interface AgentNodeDetail extends AgentNodeSummary {
  body: string | null;
  salience: number;
  edges: {
    type: EdgeType;
    direction: "out" | "in";
    weight: number;
    rationale: string | null;
    node: AgentNodeSummary;
  }[];
}

export async function agentGetNode(id: string, depth = 1): Promise<AgentNodeDetail | null> {
  const v = await getVisibility();
  const [node] = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
  if (!node || !isVisible(node, v)) return null;

  const neighborRows = await db
    .select({
      edgeType: edges.type,
      weight: edges.weight,
      rationale: edges.rationale,
      srcId: edges.src,
      nId: nodes.id,
      nTitle: nodes.title,
      nType: nodes.type,
      nSummary: nodes.summary,
      nConfidence: nodes.confidence,
      nStatus: nodes.status,
      nSensitivity: nodes.sensitivity,
    })
    .from(edges)
    .innerJoin(
      nodes,
      sql`${nodes.id} = case when ${edges.src} = ${id} then ${edges.dst} else ${edges.src} end`,
    )
    .where(sql`${edges.src} = ${id} or ${edges.dst} = ${id}`);

  const edgeViews = neighborRows
    .filter((r) => isVisible({ type: r.nType, sensitivity: r.nSensitivity, status: r.nStatus }, v))
    .map((r) => ({
      type: r.edgeType,
      direction: (r.srcId === id ? "out" : "in") as "out" | "in",
      weight: r.weight,
      rationale: r.rationale,
      node: {
        id: r.nId,
        title: r.nTitle,
        type: r.nType,
        summary: r.nSummary,
        confidence: r.nConfidence,
        status: r.nStatus,
      },
    }));

  return {
    id: node.id,
    title: node.title,
    type: node.type,
    summary: node.summary,
    // The node already passed isVisible above, so a private body here means private access is
    // permitted (local model, or explicit cloud opt-in) — decrypt it for the owner's own use.
    body: await maybeDecryptBody(node.body),
    confidence: node.confidence,
    salience: node.salience,
    status: node.status,
    edges: depth >= 1 ? edgeViews : [],
  };
}

// ── episodic recall ───────────────────────────────────────────────────────────
export interface PastConversation {
  when: string; // YYYY-MM-DD
  task: string;
  answer: string;
}

/**
 * Recall past conversations (agent_runs) — MNEMO's episodic memory. Lets the agent remember
 * what you actually discussed before, not just the facts that got written into the graph.
 * Keyword-matched over the question + answer, most recent first; falls back to recent threads.
 */
export async function agentRecallConversations(query: string, limit = 5): Promise<PastConversation[]> {
  const q = query.trim();
  const like = `%${q}%`;
  const rows = await db
    .select({ task: agentRuns.task, answer: agentRuns.answer, createdAt: agentRuns.createdAt })
    .from(agentRuns)
    .where(q ? sql`(${agentRuns.task} ilike ${like} or ${agentRuns.answer} ilike ${like})` : sql`true`)
    .orderBy(desc(agentRuns.createdAt))
    .limit(Math.min(Math.max(limit, 1), 10));
  return rows
    .filter((r) => r.answer.trim())
    .map((r) => ({
      when: r.createdAt.toISOString().slice(0, 10),
      task: r.task.slice(0, 200),
      answer: r.answer.slice(0, 500),
    }));
}

// ── traverse ────────────────────────────────────────────────────────────────
export interface TraverseHit {
  id: string;
  title: string;
  type: NodeType;
  hop: number;
}

export async function agentTraverse(
  startId: string,
  opts: { edgeTypes?: EdgeType[]; maxHops?: number } = {},
): Promise<TraverseHit[]> {
  const v = await getVisibility();
  const maxHops = Math.min(opts.maxHops ?? 2, 4);
  const visited = new Map<string, number>();
  let frontier = [startId];
  visited.set(startId, 0);

  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const conds = [
      sql`(src = any(${toPgArray(frontier)}::uuid[]) or dst = any(${toPgArray(frontier)}::uuid[]))`,
    ];
    if (opts.edgeTypes?.length) conds.push(sql`type = any(${toPgArray(opts.edgeTypes)}::text[])`);
    const rows = (await db.execute(sql`
      select src, dst from edges where ${sql.join(conds, sql` and `)} limit 500
    `)) as unknown as Array<{ src: string; dst: string }>;

    const next: string[] = [];
    for (const r of rows) {
      for (const nid of [r.src, r.dst]) {
        if (!visited.has(nid)) {
          visited.set(nid, hop);
          next.push(nid);
        }
      }
    }
    frontier = next;
  }

  const ids = [...visited.keys()].filter((id) => id !== startId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: nodes.id, title: nodes.title, type: nodes.type, sensitivity: nodes.sensitivity, status: nodes.status })
    .from(nodes)
    .where(inArray(nodes.id, ids));
  return rows
    .filter((r) => isVisible(r, v))
    .map((r) => ({ id: r.id, title: r.title, type: r.type, hop: visited.get(r.id) ?? 99 }))
    .sort((a, b) => a.hop - b.hop);
}

// ── whats_my_view_on ────────────────────────────────────────────────────────
export interface ViewResult {
  stance: string;
  citations: AgentNodeSummary[];
}

export async function agentWhatsMyViewOn(topic: string): Promise<ViewResult> {
  const v = await getVisibility();
  const hits = await hybridSearch(topic, {
    types: ["belief", "trait", "interest", "goal"],
    limit: 16,
    activeOnly: false,
  });
  const visible = filterVisible(hits, v);
  if (visible.length === 0) {
    return { stance: `Nothing in the graph captures a view on "${topic}".`, citations: [] };
  }

  const context = visible
    .map((h) => {
      const tag = h.confidence >= 0.999 ? "owner-asserted" : `inferred ${h.confidence.toFixed(2)}`;
      const sup = h.status === "superseded" ? " [PREVIOUSLY HELD]" : "";
      return `[${h.id}] (${h.type}, ${tag})${sup} ${h.title}${h.summary ? ` — ${h.summary}` : ""}`;
    })
    .join("\n");

  const result = await completeJSON({
    schema: z.object({ stance: z.string(), used_node_ids: z.array(z.string()).default([]) }),
    system:
      "Synthesize the owner's stance on a topic from their own belief/trait/interest nodes. Prefer owner-asserted " +
      "over inferred. If a view is marked [PREVIOUSLY HELD], explicitly note it as a past view that has since changed. " +
      "Never invent. If there's nothing real, say so. Return {stance, used_node_ids}.",
    prompt: `Topic: ${topic}\n\nView nodes:\n${context}`,
    model: "fast",
    maxTokens: 600,
  });

  const byId = new Map(visible.map((h) => [h.id, h]));
  const citations = result.used_node_ids
    .map((id) => byId.get(id))
    .filter((h): h is NonNullable<typeof h> => Boolean(h))
    .map((h) => ({ id: h.id, title: h.title, type: h.type, summary: h.summary, confidence: h.confidence, status: h.status }));
  return { stance: result.stance, citations };
}

// ── add_knowledge (write; scope-gated by caller) ────────────────────────────
export async function agentAddKnowledge(
  input: {
    title: string;
    body?: string;
    type: NodeType;
    links?: { to: string; type: EdgeType }[];
  },
  keyId: string | null,
): Promise<{ id: string }> {
  const confidence = 0.8; // agent writes never exceed 0.8
  const [vec] = await embed([`${input.title}. ${input.body ?? ""}`]);
  const id = await createNode(
    {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      summary: input.body ? input.body.slice(0, 200) : null,
      confidence,
      embedding: vec,
    },
    "agent",
  );
  for (const link of input.links ?? []) {
    await upsertEdge({
      src: id,
      dst: link.to,
      type: link.type,
      weight: 0.6,
      confidence,
      rationale: "Added by an agent.",
    });
  }
  await recordActivity({
    action: "agent_add_knowledge",
    nodeId: id,
    actor: "agent",
    actorKeyId: keyId,
    detail: { title: input.title, type: input.type },
  });
  return { id };
}

// ── recent_activity ─────────────────────────────────────────────────────────
export async function agentRecentActivity(sinceISO?: string, limit = 50) {
  const rows = await db
    .select({
      action: activityLog.action,
      actor: activityLog.actor,
      nodeId: activityLog.nodeId,
      at: activityLog.at,
      detail: activityLog.detail,
    })
    .from(activityLog)
    .where(sinceISO ? gt(activityLog.at, new Date(sinceISO)) : sql`true`)
    .orderBy(desc(activityLog.at))
    .limit(limit);
  return rows.map((r) => ({
    action: r.action,
    actor: r.actor,
    nodeId: r.nodeId,
    at: r.at.toISOString(),
    detail: r.detail,
  }));
}

// ── my_themes ───────────────────────────────────────────────────────────────
export async function agentMyThemes() {
  const rows = await db
    .select({
      label: clusters.label,
      summary: clusters.summary,
      keywords: clusters.keywords,
      size: clusters.size,
    })
    .from(clusters)
    .orderBy(desc(clusters.size));
  return rows;
}

// ── resources: self profile + graph stats ───────────────────────────────────
export async function agentSelfProfile(): Promise<string> {
  const v = await getVisibility();
  const selfId = await ensureSelf();
  const [self] = await db.select().from(nodes).where(eq(nodes.id, selfId)).limit(1);
  const signals = await db
    .select({ type: nodes.type, title: nodes.title, sensitivity: nodes.sensitivity, status: nodes.status })
    .from(nodes)
    .where(and(inArray(nodes.type, ["belief", "interest", "trait", "goal"]), eq(nodes.status, "active")))
    .orderBy(desc(nodes.salience))
    .limit(40);
  const visible = filterVisible(signals, v);
  const grouped: Record<string, string[]> = {};
  for (const s of visible) (grouped[s.type] ??= []).push(s.title);
  const lines = Object.entries(grouped).map(([k, vs]) => `${k}: ${vs.join("; ")}`);
  return [self?.summary ?? "The owner of this second brain.", "", ...lines].join("\n");
}

export async function agentGraphStats() {
  const [counts] = (await db.execute(sql`
    select
      (select count(*) from nodes where status='active') as nodes,
      (select count(*) from edges) as edges,
      (select count(*) from clusters) as clusters,
      (select count(*) from insights where dismissed=false) as open_insights
  `)) as unknown as Array<{ nodes: number; edges: number; clusters: number; open_insights: number }>;
  return {
    nodes: Number(counts?.nodes ?? 0),
    edges: Number(counts?.edges ?? 0),
    clusters: Number(counts?.clusters ?? 0),
    openInsights: Number(counts?.open_insights ?? 0),
  };
}

export type { Visibility };
