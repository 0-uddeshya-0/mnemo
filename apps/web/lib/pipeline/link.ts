/**
 * Stage 5 — Link (the heart). Provenance edges are created deterministically in run.ts.
 * Here we: (2) find semantic neighbors via kNN, (3) let the LLM adjudicate the specific,
 * rationale-bearing edge types, and run the belief-evolution / supersession check.
 */
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { edges, insights, nodes } from "@/lib/db/schema";
import { completeJSON } from "@/lib/llm";
import { getNode, nearestNodes, upsertEdge } from "@/lib/graph/store";
import { VERSIONED_NODE_TYPES } from "@/lib/graph/constants";

// Edge types the LLM may assign during semantic adjudication. Structural types
// (authored_by/learned_from/believes/interested_in/aspires_to/supersedes) are reserved
// for deterministic provenance / self-layer / evolution logic.
const ADJUDICATION_EDGE_TYPES = [
  "relates_to",
  "part_of",
  "instance_of",
  "influenced_by",
  "contradicts",
  "supports",
  "precedes",
  "similar_to",
  "mentions",
  "applies_skill",
] as const;

const LinkSchema = z.object({
  edges: z
    .array(
      z.object({
        candidate: z.number().int().nonnegative(),
        type: z.enum(ADJUDICATION_EDGE_TYPES),
        weight: z.number().min(0).max(1),
        rationale: z.string(),
      }),
    )
    .default([]),
});

const LINK_SYSTEM = [
  "You assign typed relationships between a NEW node and candidate neighbor nodes in a",
  "single person's knowledge graph. Return JSON: { edges: [{candidate, type, weight, rationale}] }.",
  "`candidate` is the integer index of the neighbor. Choose the MOST SPECIFIC type from:",
  ADJUDICATION_EDGE_TYPES.join(", ") + ".",
  "Rules: prefer few, specific, rationale-bearing edges over many weak `relates_to` links.",
  "Discard spurious or merely-coincidental similarity. `weight` 0–1 reflects strength.",
  "`rationale` is ONE short line explaining why the edge exists. Omit a candidate entirely",
  "if there is no real relationship.",
].join("\n");

/** Stage 5.2 + 5.3: semantic neighbors → the LLM-adjudicated typed edges. */
export async function adjudicateLinks(nodeId: string): Promise<number> {
  const node = await getNode(nodeId);
  if (!node || !node.embedding) return 0;

  const neighbors = await nearestNodes(node.embedding, {
    k: 8,
    minCosine: 0.78,
    excludeIds: [nodeId],
  });
  if (neighbors.length === 0) return 0;

  const candidateList = neighbors
    .map((n, i) => `[${i}] (${n.type}) ${n.title}${n.summary ? ` — ${n.summary}` : ""}`)
    .join("\n");

  const prompt = [
    `NEW NODE (${node.type}): ${node.title}`,
    node.summary ? `Summary: ${node.summary}` : "",
    "",
    "CANDIDATE NEIGHBORS:",
    candidateList,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await completeJSON({
    schema: LinkSchema,
    system: LINK_SYSTEM,
    prompt,
    model: "fast",
    maxTokens: 1024,
  });

  let created = 0;
  for (const e of result.edges) {
    const neighbor = neighbors[e.candidate];
    if (!neighbor) continue;
    await upsertEdge({
      src: nodeId,
      dst: neighbor.id,
      type: e.type,
      weight: e.weight,
      confidence: 0.7,
      rationale: e.rationale,
    });
    created++;
  }

  await checkBeliefEvolution(nodeId);
  return created;
}

/**
 * Belief-evolution check: if the new node is a belief/trait/goal that `contradicts` an
 * existing OWNER-ASSERTED node of the same type (high weight), do NOT overwrite. Create a
 * `supersedes` CANDIDATE edge + an `evolution` insight for the owner to confirm.
 */
export async function checkBeliefEvolution(nodeId: string): Promise<void> {
  const node = await getNode(nodeId);
  if (!node) return;
  if (!VERSIONED_NODE_TYPES.includes(node.type)) return;
  if (node.confidence < 0.9) return; // only owner-asserted new views supersede

  // contradicts edges from this node to same-type owner-asserted active nodes
  const rows = (await db.execute(sql`
    select e.dst as dst, e.weight as weight, n.title as title
    from edges e
    join nodes n on n.id = e.dst
    where e.src = ${nodeId}
      and e.type = 'contradicts'
      and e.weight >= 0.5
      and n.type = ${node.type}
      and n.status = 'active'
      and n.confidence >= 0.999
  `)) as unknown as Array<{ dst: string; weight: number; title: string }>;

  for (const row of rows) {
    // candidate supersedes edge (owner confirms before status flips)
    await upsertEdge({
      src: nodeId,
      dst: row.dst,
      type: "supersedes",
      weight: 0.5,
      confidence: 0.5,
      rationale: "Possible evolution of an earlier view — awaiting owner confirmation.",
    });

    // avoid duplicate open insights for the same pair
    const [existing] = await db
      .select({ id: insights.id })
      .from(insights)
      .where(
        and(
          eq(insights.kind, "evolution"),
          eq(insights.dismissed, false),
          sql`${insights.nodeIds} @> ARRAY[${nodeId}::uuid, ${row.dst}::uuid]`,
        ),
      )
      .limit(1);
    if (existing) continue;

    await db.insert(insights).values({
      kind: "evolution",
      title: `Your view may have evolved: "${row.title}"`,
      detail: {
        message: `You previously held "${row.title}", but "${node.title}" suggests a changed view. Confirm to supersede the old one.`,
        newNodeId: nodeId,
        oldNodeId: row.dst,
      },
      nodeIds: [nodeId, row.dst],
    });
  }
}

/** Confirm a supersession (owner action): snapshot old node, flip to superseded. */
export async function confirmSupersession(newId: string, oldId: string): Promise<void> {
  const oldNode = await getNode(oldId);
  if (!oldNode) return;
  // snapshot prior state into node_versions, then flip status
  const { snapshotNodeVersion } = await import("@/lib/graph/store");
  await snapshotNodeVersion(oldNode, "Superseded by a newer view");
  await db.update(nodes).set({ status: "superseded" }).where(eq(nodes.id, oldId));
  await upsertEdge({
    src: newId,
    dst: oldId,
    type: "supersedes",
    weight: 1,
    confidence: 1,
    rationale: "Owner confirmed this view replaces the earlier one.",
  });
}
