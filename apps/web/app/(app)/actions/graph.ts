"use server";
import { z } from "zod";
import { assertOwner } from "@/lib/auth/guard";
import { getGraphData, type GraphData, type GraphFilters } from "@/lib/graph/read";
import { createNode } from "@/lib/graph/store";
import { embed } from "@/lib/embeddings";
import { NODE_TYPES } from "@/lib/graph/constants";

export async function getGraphDataAction(filters: GraphFilters): Promise<GraphData> {
  await assertOwner();
  return getGraphData(filters);
}

const QuickAddSchema = z.object({
  title: z.string().min(1),
  type: z.enum(NODE_TYPES),
});

export async function quickAddNodeAction(
  input: z.infer<typeof QuickAddSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await assertOwner();
  const parsed = QuickAddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid node." };
  const { title, type } = parsed.data;
  const [vec] = await embed([title]);
  const id = await createNode({ type, title, confidence: 1, embedding: vec }, "owner");
  return { ok: true, id };
}

export type { GraphData, GraphFilters };
