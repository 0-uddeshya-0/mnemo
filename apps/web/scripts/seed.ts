/**
 * Seed a small, believable demo brain so the UI is never empty on first look. Idempotent:
 * re-running deletes prior seed data (tagged properties.seed=true) and rebuilds. Embeddings
 * run locally (no key needed); the model downloads once on first run.
 *
 *   pnpm db:seed
 */
import "@/lib/server/load-env";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, edges, insights, nodes } from "@/lib/db/schema";
import { activeEmbedProvider, embed } from "@/lib/embeddings";
import { maybeEncryptBody } from "@/lib/crypto";
import { ensureSelf } from "@/lib/graph/self";
import type { EdgeType, NodeType, Sensitivity } from "@/lib/graph/constants";

interface Spec {
  key: string;
  type: NodeType;
  title: string;
  body?: string;
  summary?: string;
  confidence?: number;
  sensitivity?: Sensitivity;
  salience?: number;
  props?: Record<string, unknown>;
}

const SPECS: Spec[] = [
  // beliefs (owner-asserted)
  { key: "b_constraints", type: "belief", title: "Constraints breed creativity", body: "Limits force invention; a blank canvas is paralyzing.", confidence: 1, salience: 0.8 },
  { key: "b_productivity", type: "belief", title: "Most productivity advice is procrastination in disguise", confidence: 1, salience: 0.7 },
  { key: "b_writing", type: "belief", title: "Writing is thinking made visible", confidence: 1, salience: 0.75 },
  { key: "b_determinism", type: "belief", title: "Free will is largely an illusion", body: "Our choices are downstream of causes we didn't choose.", confidence: 1, salience: 0.7 },
  { key: "b_change", type: "belief", title: "People can fundamentally change who they are", confidence: 1, salience: 0.7 },
  // interests
  { key: "i_cogsci", type: "interest", title: "Cognitive science", confidence: 1, salience: 0.8 },
  { key: "i_stoic", type: "interest", title: "Stoic philosophy", confidence: 1, salience: 0.7 },
  { key: "i_genart", type: "interest", title: "Generative art", confidence: 1, salience: 0.6 },
  { key: "i_systems", type: "interest", title: "Systems thinking", confidence: 1, salience: 0.7 },
  { key: "i_type", type: "interest", title: "Typography", confidence: 1, salience: 0.5 },
  // traits
  { key: "t_open", type: "trait", title: "high Openness", body: "Drawn to novelty, abstraction, and aesthetic experience.", confidence: 0.6, props: { inferred: true } },
  { key: "t_consc", type: "trait", title: "high Conscientiousness", confidence: 0.6, props: { inferred: true } },
  // goals
  { key: "g_book", type: "goal", title: "Write a book on attention", confidence: 1, salience: 0.8 },
  { key: "g_tool", type: "goal", title: "Build a tool that thinks with me", confidence: 1, salience: 0.7 },
  // memory (private → encrypted)
  { key: "m_morning", type: "memory", title: "The quiet morning I decided to start writing", body: "A specific cold January morning that set everything in motion.", confidence: 1, sensitivity: "private", salience: 0.6 },
  // sources
  { key: "s_tfas", type: "book", title: "Thinking, Fast and Slow", body: "Daniel Kahneman on the two systems of thought.", confidence: 1, salience: 0.8, props: { author: "Daniel Kahneman", year: 2011 } },
  { key: "s_context", type: "article", title: "The Cost of Context Switching", confidence: 1, salience: 0.6, props: { url: "https://example.com/context-switching" } },
  { key: "s_poem", type: "creative_work", title: "On Quiet Mornings", body: "A short poem about attention and stillness.", confidence: 1, salience: 0.55 },
  // concepts
  { key: "c_systems12", type: "concept", title: "System 1 / System 2", body: "Fast, intuitive thinking vs. slow, deliberate reasoning.", confidence: 0.7, salience: 0.7 },
  { key: "c_cogload", type: "concept", title: "Cognitive load", body: "The amount of working memory in use.", confidence: 0.7, salience: 0.6 },
  { key: "c_flow", type: "concept", title: "Flow state", body: "Total absorption in a challenging task.", confidence: 0.7, salience: 0.6 },
  { key: "c_rrf", type: "concept", title: "Reciprocal Rank Fusion", body: "A method to merge ranked lists from multiple retrievers.", confidence: 0.7, salience: 0.5 },
  { key: "c_kg", type: "concept", title: "Knowledge graphs", body: "Typed nodes and edges modeling a domain.", confidence: 0.7, salience: 0.6 },
  // skills
  { key: "sk_writing", type: "skill", title: "Technical writing", confidence: 0.8, salience: 0.6 },
  { key: "sk_ts", type: "skill", title: "TypeScript", confidence: 0.8, salience: 0.6 },
  // people
  { key: "p_kahneman", type: "person", title: "Daniel Kahneman", confidence: 0.8, props: { role: "psychologist" } },
  { key: "p_marcus", type: "person", title: "Marcus Aurelius", confidence: 0.8, props: { role: "Stoic emperor" } },
  // quote
  { key: "q_blind", type: "quote", title: "We can be blind to the obvious…", body: "We can be blind to the obvious, and we are also blind to our blindness.", confidence: 0.9, props: { why_notable: "On the limits of self-awareness." } },
  // question
  { key: "qq_attention", type: "question", title: "Can sustained attention be trained, or only protected?", confidence: 0.6, salience: 0.5 },
];

const EDGES: [string, string, EdgeType, number, string][] = [
  ["self", "b_constraints", "believes", 0.9, "Stated by the owner."],
  ["self", "b_productivity", "believes", 0.9, "Stated by the owner."],
  ["self", "b_writing", "believes", 0.9, "Stated by the owner."],
  ["self", "b_determinism", "believes", 0.9, "Stated by the owner."],
  ["self", "b_change", "believes", 0.9, "Stated by the owner."],
  ["self", "i_cogsci", "interested_in", 0.9, "Stated interest."],
  ["self", "i_stoic", "interested_in", 0.9, "Stated interest."],
  ["self", "i_genart", "interested_in", 0.8, "Stated interest."],
  ["self", "i_systems", "interested_in", 0.8, "Stated interest."],
  ["self", "i_type", "interested_in", 0.7, "Stated interest."],
  ["self", "t_open", "relates_to", 0.6, "Inferred trait."],
  ["self", "t_consc", "relates_to", 0.6, "Inferred trait."],
  ["self", "g_book", "aspires_to", 0.9, "Quietly building toward this."],
  ["self", "g_tool", "aspires_to", 0.9, "Quietly building toward this."],
  ["self", "m_morning", "relates_to", 0.7, "A formative memory."],
  ["s_tfas", "self", "learned_from", 0.9, "Read by the owner."],
  ["s_context", "self", "learned_from", 0.9, "Read by the owner."],
  ["s_poem", "self", "learned_from", 0.9, "Written by the owner."],
  ["s_tfas", "p_kahneman", "authored_by", 0.9, "Author of the book."],
  ["q_blind", "s_tfas", "learned_from", 0.85, "Highlight from the book."],
  ["c_systems12", "s_tfas", "learned_from", 0.8, "Concept from the book."],
  ["c_cogload", "s_tfas", "learned_from", 0.7, "Concept from the book."],
  ["c_systems12", "c_cogload", "relates_to", 0.6, "Both about mental processing."],
  ["c_cogload", "c_flow", "relates_to", 0.6, "Load shapes whether flow is reachable."],
  ["c_kg", "c_rrf", "part_of", 0.6, "RRF powers search over the graph."],
  ["b_writing", "g_book", "supports", 0.7, "The belief motivates the goal."],
  ["b_constraints", "s_poem", "influenced_by", 0.6, "The poem embodies the belief."],
  ["i_stoic", "p_marcus", "relates_to", 0.7, "A central Stoic figure."],
  ["g_tool", "c_kg", "applies_skill", 0.6, "The tool is a knowledge graph."],
  ["g_tool", "sk_ts", "applies_skill", 0.6, "Built in TypeScript."],
  ["b_writing", "sk_writing", "relates_to", 0.6, "Practice of the belief."],
  ["qq_attention", "g_book", "relates_to", 0.6, "The open question the book circles."],
  // the tension
  ["b_determinism", "b_change", "contradicts", 0.7, "If choices are determined, can people truly change?"],
];

async function main() {
  console.log(`Seeding demo brain (embedder: ${activeEmbedProvider()})…`);

  // idempotent reset
  await db.execute(sql`delete from nodes where properties->>'seed' = 'true'`);
  await db.delete(insights);
  await db.delete(clusters);

  const selfId = await ensureSelf();
  await db.execute(sql`update nodes set summary = 'A curious systems-thinker who reads widely and writes to think.' where id = ${selfId}`);

  // batch embed
  const vectors = await embed(
    SPECS.map((s) => `${s.title}. ${s.body ?? ""}`),
  );

  const idByKey = new Map<string, string>([["self", selfId]]);
  const provider = activeEmbedProvider();
  for (let i = 0; i < SPECS.length; i++) {
    const s = SPECS[i]!;
    const body = await maybeEncryptBody(s.body ?? null, s.sensitivity ?? "normal");
    const [row] = await db
      .insert(nodes)
      .values({
        type: s.type,
        title: s.title,
        body,
        summary: s.summary ?? s.body?.slice(0, 160) ?? null,
        properties: { ...(s.props ?? {}), seed: true },
        confidence: s.confidence ?? 0.7,
        salience: s.salience ?? 0.5,
        sensitivity: s.sensitivity ?? "normal",
        embedding: vectors[i] ?? null,
        embedProvider: provider,
      })
      .returning({ id: nodes.id });
    if (row) idByKey.set(s.key, row.id);
  }

  // edges
  let edgeCount = 0;
  for (const [srcKey, dstKey, type, weight, rationale] of EDGES) {
    const src = idByKey.get(srcKey);
    const dst = idByKey.get(dstKey);
    if (!src || !dst) continue;
    await db
      .insert(edges)
      .values({ src, dst, type, weight, confidence: 0.9, rationale })
      .onConflictDoNothing();
    edgeCount++;
  }

  // clusters (so the cluster lens + my_themes work without running synthesis)
  const mindKeys = ["c_systems12", "c_cogload", "c_flow", "i_cogsci", "g_book", "qq_attention", "s_tfas"];
  const stoicKeys = ["i_stoic", "p_marcus", "b_determinism", "b_change", "m_morning"];
  const clusterDefs = [
    { label: "Mind & Attention", summary: "How thinking works and how attention is spent.", keywords: ["cognition", "attention", "flow"], keys: mindKeys },
    { label: "Stoicism & the Self", summary: "Living deliberately; agency, change, and acceptance.", keywords: ["stoicism", "agency", "change"], keys: stoicKeys },
  ];
  for (const c of clusterDefs) {
    const memberIds = c.keys.map((k) => idByKey.get(k)).filter((x): x is string => Boolean(x));
    const [cluster] = await db
      .insert(clusters)
      .values({ label: c.label, summary: c.summary, keywords: c.keywords, size: memberIds.length })
      .returning({ id: clusters.id });
    if (cluster) {
      await db.execute(sql`update nodes set cluster_id = ${cluster.id} where id = any(${`{${memberIds.join(",")}}`}::uuid[])`);
    }
  }

  // a few insights so /insights isn't empty before synthesis runs
  await db.insert(insights).values([
    {
      kind: "contradiction",
      title: `"Free will is largely an illusion" vs "People can fundamentally change who they are"`,
      detail: { message: "You hold both — if choices are determined, what does 'change' mean?", a: idByKey.get("b_determinism"), b: idByKey.get("b_change") },
      nodeIds: [idByKey.get("b_determinism")!, idByKey.get("b_change")!],
    },
    {
      kind: "cluster",
      title: "Theme: Mind & Attention",
      detail: { summary: "How thinking works and how attention is spent.", keywords: ["cognition", "attention", "flow"] },
      nodeIds: [idByKey.get("c_systems12")!, idByKey.get("c_flow")!, idByKey.get("g_book")!],
    },
    {
      kind: "gap",
      title: "Gap in Mind & Attention: the attention economy's incentives",
      detail: { missing: "How platforms profit from fragmenting attention", why: "You study attention internally but have nothing on the economic forces shaping it." },
      nodeIds: [idByKey.get("g_book")!, idByKey.get("c_cogload")!],
    },
  ]);

  console.log(`✓ Seeded ${SPECS.length} nodes, ${edgeCount} edges, 2 clusters, 3 insights.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
