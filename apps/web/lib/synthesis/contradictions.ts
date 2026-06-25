/**
 * Contradiction surfacing: explicit `contradicts` edges among owner-asserted nodes, plus a
 * light cosine-tension pass where the LLM judges whether similar owner beliefs are in tension.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { completeJSON } from "@/lib/llm";
import { nearestNodes } from "@/lib/graph/store";
import { createInsightIfNew } from "@/lib/synthesis/insights";

export async function findContradictions(): Promise<number> {
  let created = 0;

  // 1) explicit contradicts edges between owner-asserted active nodes
  const explicit = (await db.execute(sql`
    select e.src as src, e.dst as dst, ns.title as s_title, nd.title as d_title
    from edges e
    join nodes ns on ns.id = e.src
    join nodes nd on nd.id = e.dst
    where e.type = 'contradicts'
      and ns.status = 'active' and nd.status = 'active'
      and ns.confidence >= 0.999 and nd.confidence >= 0.999
  `)) as unknown as Array<{ src: string; dst: string; s_title: string; d_title: string }>;

  for (const r of explicit) {
    const ok = await createInsightIfNew(
      "contradiction",
      `"${r.s_title}" vs "${r.d_title}"`,
      { message: `You hold "${r.s_title}" and "${r.d_title}" — these may be in tension.`, a: r.src, b: r.dst },
      [r.src, r.dst],
    );
    if (ok) created++;
  }

  // 2) light cosine-tension pass over owner-asserted beliefs
  const beliefs = await db
    .select({ id: nodes.id, title: nodes.title, embedding: nodes.embedding })
    .from(nodes)
    .where(and(eq(nodes.type, "belief"), eq(nodes.status, "active"), sql`confidence >= 0.999`))
    .limit(40);

  const seen = new Set<string>();
  const candidates: { a: string; b: string; aTitle: string; bTitle: string }[] = [];
  for (const belief of beliefs) {
    if (!belief.embedding) continue;
    const near = await nearestNodes(belief.embedding, { k: 3, types: ["belief"], excludeIds: [belief.id] });
    for (const n of near) {
      if (n.cosine < 0.5 || n.cosine > 0.9) continue;
      const pairKey = [belief.id, n.id].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      candidates.push({ a: belief.id, b: n.id, aTitle: belief.title, bTitle: n.title });
      if (candidates.length >= 10) break;
    }
    if (candidates.length >= 10) break;
  }

  if (candidates.length > 0) {
    const judged = await completeJSON({
      schema: z.object({ tensions: z.array(z.number().int()).default([]) }),
      system:
        "You are given numbered pairs of one person's stated beliefs. Return the indices of pairs that " +
        "are genuinely in TENSION (hard to hold both sincerely), not merely related. Return {tensions:[indices]}.",
      prompt: candidates.map((c, i) => `[${i}] "${c.aTitle}"  ⟷  "${c.bTitle}"`).join("\n"),
      model: "fast",
      maxTokens: 256,
    });
    for (const idx of judged.tensions) {
      const c = candidates[idx];
      if (!c) continue;
      const ok = await createInsightIfNew(
        "contradiction",
        `"${c.aTitle}" vs "${c.bTitle}"`,
        { message: `These two beliefs may be in tension.`, a: c.a, b: c.b },
        [c.a, c.b],
      );
      if (ok) created++;
    }
  }

  return created;
}
