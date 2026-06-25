"use server";
import { z } from "zod";
import { assertOwner } from "@/lib/auth/guard";
import { getNodeDetail, searchNodesForPicker, type NodeDetail } from "@/lib/graph/detail";
import {
  addConnection,
  deleteNode,
  relinkNode,
  removeConnection,
  updateNode,
} from "@/lib/graph/mutate";
import { confirmSupersession } from "@/lib/pipeline/link";
import { EDGE_TYPES, SENSITIVITIES } from "@/lib/graph/constants";

export async function getNodeDetailAction(id: string): Promise<NodeDetail | null> {
  await assertOwner();
  return getNodeDetail(id);
}

const PatchSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  properties: z.record(z.unknown()).optional(),
  sensitivity: z.enum(SENSITIVITIES).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export async function updateNodeAction(
  id: string,
  patch: z.infer<typeof PatchSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertOwner();
  const parsed = PatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  await updateNode(id, parsed.data);
  return { ok: true };
}

export async function searchPickerAction(query: string, excludeId?: string) {
  await assertOwner();
  return searchNodesForPicker(query, excludeId);
}

const AddConnSchema = z.object({
  src: z.string().uuid(),
  dst: z.string().uuid(),
  type: z.enum(EDGE_TYPES),
  rationale: z.string().optional(),
});

export async function addConnectionAction(
  input: z.infer<typeof AddConnSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertOwner();
  const parsed = AddConnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  await addConnection(parsed.data);
  return { ok: true };
}

export async function removeConnectionAction(edgeId: string): Promise<{ ok: true }> {
  await assertOwner();
  await removeConnection(edgeId);
  return { ok: true };
}

export async function deleteNodeAction(id: string): Promise<{ ok: true }> {
  await assertOwner();
  await deleteNode(id);
  return { ok: true };
}

export async function relinkNodeAction(id: string): Promise<{ ok: true; created: number }> {
  await assertOwner();
  const created = await relinkNode(id);
  return { ok: true, created };
}

export async function confirmSupersessionAction(
  newId: string,
  oldId: string,
): Promise<{ ok: true }> {
  await assertOwner();
  await confirmSupersession(newId, oldId);
  return { ok: true };
}

// Re-exported (type only) for typed imports in client components.
export type { NodeDetail };
