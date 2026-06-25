/**
 * Owner-driven graph mutations (drawer edits, connection add/remove, delete, re-link).
 * Belief/trait/goal content edits snapshot a version first; content edits re-embed so
 * search stays accurate; sensitivity changes re-encrypt the body accordingly.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { edges, nodes } from "@/lib/db/schema";
import { activeEmbedProvider, embed } from "@/lib/embeddings";
import { maybeDecryptBody, maybeEncryptBody } from "@/lib/crypto";
import {
  getNode,
  reconcileSalience,
  recordActivity,
  snapshotNodeVersion,
  upsertEdge,
} from "@/lib/graph/store";
import { adjudicateLinks } from "@/lib/pipeline/link";
import { VERSIONED_NODE_TYPES, type EdgeType, type Sensitivity } from "@/lib/graph/constants";

export interface NodePatch {
  title?: string;
  body?: string | null;
  summary?: string | null;
  properties?: Record<string, unknown>;
  sensitivity?: Sensitivity;
  confidence?: number;
}

export async function updateNode(id: string, patch: NodePatch): Promise<void> {
  const node = await getNode(id);
  if (!node) throw new Error("node not found");

  const versioned = VERSIONED_NODE_TYPES.includes(node.type);
  const titleChanged = patch.title !== undefined && patch.title !== node.title;
  const contentChanged = titleChanged || patch.body !== undefined || patch.summary !== undefined;

  if (versioned && contentChanged) {
    await snapshotNodeVersion(node, "Owner edit");
  }

  const set: Partial<typeof nodes.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (patch.properties !== undefined) set.properties = patch.properties;
  if (patch.confidence !== undefined) set.confidence = patch.confidence;

  const newSensitivity = patch.sensitivity ?? node.sensitivity;
  const newBodyPlain =
    patch.body !== undefined ? patch.body : await maybeDecryptBody(node.body);
  if (patch.sensitivity !== undefined) set.sensitivity = newSensitivity;
  if (patch.body !== undefined || patch.sensitivity !== undefined) {
    set.body = await maybeEncryptBody(newBodyPlain ?? null, newSensitivity);
  }

  if (contentChanged) {
    const text = `${patch.title ?? node.title}\n${patch.summary ?? node.summary ?? ""}\n${(newBodyPlain ?? "").slice(0, 4000)}`;
    const [vec] = await embed([text]);
    if (vec) {
      set.embedding = vec;
      set.embedProvider = activeEmbedProvider();
    }
  }

  await db.update(nodes).set(set).where(eq(nodes.id, id));
  await recordActivity({
    action: "edit_node",
    nodeId: id,
    actor: "owner",
    detail: { fields: Object.keys(patch) },
  });
  await reconcileSalience(id);
}

export async function addConnection(input: {
  src: string;
  dst: string;
  type: EdgeType;
  rationale?: string;
}): Promise<void> {
  await upsertEdge({
    src: input.src,
    dst: input.dst,
    type: input.type,
    weight: 0.7,
    confidence: 1,
    rationale: input.rationale ?? "Added by the owner.",
  });
  await recordActivity({
    action: "add_edge",
    nodeId: input.src,
    actor: "owner",
    detail: { dst: input.dst, type: input.type },
  });
  await reconcileSalience(input.src);
  await reconcileSalience(input.dst);
}

export async function removeConnection(edgeId: string): Promise<void> {
  await db.delete(edges).where(eq(edges.id, edgeId));
  await recordActivity({ action: "remove_edge", actor: "owner", detail: { edgeId } });
}

export async function deleteNode(id: string): Promise<void> {
  await recordActivity({ action: "delete_node", nodeId: null, actor: "owner", detail: { id } });
  await db.delete(nodes).where(eq(nodes.id, id));
}

/** Re-run Stage 5 linking for a single node. */
export async function relinkNode(id: string): Promise<number> {
  const created = await adjudicateLinks(id);
  await reconcileSalience(id);
  return created;
}
