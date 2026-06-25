/**
 * Gap detection: for dense theme clusters, ask the LLM what an expert in that theme would
 * expect the owner to also know or hold a view on, that is absent from the graph.
 */
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { completeJSON } from "@/lib/llm";
import { createInsightIfNew } from "@/lib/synthesis/insights";
import type { ClusterResult } from "@/lib/synthesis/cluster";

export async function findGaps(clusters: ClusterResult[]): Promise<number> {
  const dense = clusters.filter((c) => c.memberIds.length >= 4).slice(0, 4);
  let created = 0;

  for (const cluster of dense) {
    const members = await db
      .select({ title: nodes.title, type: nodes.type })
      .from(nodes)
      .where(inArray(nodes.id, cluster.memberIds))
      .limit(24);

    const res = await completeJSON({
      schema: z.object({
        gaps: z.array(z.object({ missing: z.string(), why: z.string() })).default([]),
      }),
      system:
        "You audit one person's knowledge on a theme for blind spots. Given what they know, name up to 2 " +
        "specific things an expert would expect them to ALSO understand or have a view on, that is absent. " +
        "Be concrete (a named critique, counter-position, method, or adjacent idea). Return {gaps:[{missing,why}]}.",
      prompt: `Theme: ${cluster.label}\n\nWhat they know:\n${members
        .map((m) => `- (${m.type}) ${m.title}`)
        .join("\n")}`,
      model: "deep",
      maxTokens: 500,
    });

    for (const gap of res.gaps.slice(0, 2)) {
      const ok = await createInsightIfNew(
        "gap",
        `Gap in ${cluster.label}: ${gap.missing}`,
        { missing: gap.missing, why: gap.why, cluster: cluster.label },
        cluster.memberIds.slice(0, 8),
      );
      if (ok) created++;
    }
  }
  return created;
}
