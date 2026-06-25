/**
 * RAG over the graph (Ask + the MCP `whats_my_view_on` tool share this). Hybrid-retrieve →
 * expand 1 hop along high-weight edges → assemble context → the LLM answers grounded in the
 * owner's nodes, owner-asserted outranking inferred, superseded views surfaced, never
 * fabricating provenance.
 */
import { z } from "zod";
import { inArray, sql } from "drizzle-orm";
import { db, toPgArray } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { completeJSON } from "@/lib/llm";
import { hybridSearch } from "@/lib/search";
import { getAgentExposure } from "@/lib/settings";
import { maybeDecryptBody } from "@/lib/crypto";
import type { NodeType } from "@/lib/graph/constants";

export interface Citation {
  id: string;
  title: string;
  type: NodeType;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
}

interface ContextNode {
  id: string;
  title: string;
  type: NodeType;
  confidence: number;
  status: string;
  text: string;
}

const RAG_SYSTEM = [
  "You answer as informed by the OWNER's own knowledge graph — their reading, writing, beliefs, and",
  "stated views. Use ONLY the provided context nodes; do not bring in outside facts.",
  "",
  "Rules:",
  "- Prefer owner-asserted (confidence 1.0) content over inferred; never let an inference outweigh a stated belief.",
  "- If a relevant view is marked SUPERSEDED, state BOTH the earlier and current view and that it changed.",
  "- Flag inferences explicitly (e.g. 'you seem to…').",
  "- NEVER fabricate provenance or facts. If the context doesn't cover the question, say so plainly.",
  "- Write in second person ('you'), warm and concise.",
  "Return {answer, used_node_ids} where used_node_ids are the ids of context nodes you actually drew on.",
].join("\n");

async function expandHighWeight(ids: string[], minWeight: number): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = (await db.execute(sql`
    select case when src = any(${toPgArray(ids)}::uuid[]) then dst else src end as nid
    from edges
    where weight >= ${minWeight}
      and (src = any(${toPgArray(ids)}::uuid[]) or dst = any(${toPgArray(ids)}::uuid[]))
    limit 60
  `)) as unknown as Array<{ nid: string }>;
  return rows.map((r) => r.nid);
}

async function loadContext(ids: string[]): Promise<ContextNode[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: nodes.id,
      title: nodes.title,
      type: nodes.type,
      confidence: nodes.confidence,
      status: nodes.status,
      sensitivity: nodes.sensitivity,
      summary: nodes.summary,
      body: nodes.body,
    })
    .from(nodes)
    .where(inArray(nodes.id, ids));

  // Privacy: private nodes enter the answer context only when inference is local (or the
  // owner has explicitly opted into cloud). Resolved model-aware in one place.
  const { exposePrivate } = await getAgentExposure();
  const out: ContextNode[] = [];
  for (const r of rows) {
    if (r.sensitivity === "private" && !exposePrivate) continue;
    // Private bodies are encrypted at rest — decrypt for the owner's own local context.
    const text = r.summary || (await maybeDecryptBody(r.body)) || "";
    out.push({
      id: r.id,
      title: r.title,
      type: r.type,
      confidence: r.confidence,
      status: r.status,
      text: text.slice(0, 400),
    });
  }
  return out;
}

export async function askBrain(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<AskResult> {
  const hits = await hybridSearch(question, { limit: 12, activeOnly: false });
  if (hits.length === 0) {
    return {
      answer:
        "There's nothing in your graph about that yet — so I won't guess. Capture something on it and ask again.",
      citations: [],
    };
  }

  const baseIds = hits.slice(0, 6).map((h) => h.id);
  const expanded = await expandHighWeight(baseIds, 0.5);
  const allIds = [...new Set([...hits.map((h) => h.id), ...expanded])].slice(0, 20);

  const ctx = await loadContext(allIds);
  // owner-asserted first, then by original retrieval order
  const rank = new Map(hits.map((h, i) => [h.id, i]));
  ctx.sort((a, b) => b.confidence - a.confidence || (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));

  const contextText = ctx
    .map((c) => {
      const tag =
        c.confidence >= 0.999 ? "owner-asserted" : `inferred ${c.confidence.toFixed(2)}`;
      const sup = c.status === "superseded" ? ", SUPERSEDED" : "";
      return `[${c.id}] (${c.type}, ${tag}${sup}) ${c.title}\n${c.text}`;
    })
    .join("\n\n");

  const historyText = history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "You" : "Brain"}: ${m.content}`)
    .join("\n");

  const result = await completeJSON({
    schema: z.object({ answer: z.string(), used_node_ids: z.array(z.string()).default([]) }),
    system: RAG_SYSTEM,
    prompt: [
      historyText ? `Conversation so far:\n${historyText}\n` : "",
      `Question: ${question}`,
      "",
      "Context nodes:",
      contextText,
    ]
      .filter(Boolean)
      .join("\n"),
    model: "fast",
    maxTokens: 900,
  });

  const byId = new Map(ctx.map((c) => [c.id, c]));
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const id of result.used_node_ids) {
    const c = byId.get(id);
    if (c && !seen.has(id)) {
      seen.add(id);
      citations.push({ id: c.id, title: c.title, type: c.type });
    }
  }

  return { answer: result.answer, citations };
}
