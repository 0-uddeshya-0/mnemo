/**
 * Turn an uploaded photo into a memory node: MNEMO looks at it (local vision model),
 * writes a description, links it to the owner, and surfaces a clarifying question when it's
 * unsure (who someone is, where/when). Photos are stored private (encrypted body).
 */
import { z } from "zod";
import { describeImage } from "@/lib/vision";
import { photoDataUri } from "@/lib/photos";
import { embed } from "@/lib/embeddings";
import { completeJSON } from "@/lib/llm";
import { createNode, upsertEdge, mergeOrInsertAtom, recordActivity } from "@/lib/graph/store";
import { ensureSelf } from "@/lib/graph/self";
import { recordPhotoFaces, tagPhotoFace } from "@/lib/faces";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { NodeType } from "@/lib/graph/constants";

export interface PhotoIngestResult {
  nodeId: string;
  caption: string;
  question: string | null;
  linked: number;
}

const EntitySchema = z.object({
  people: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  orgs: z.array(z.string()).default([]),
});

export async function runPhotoIngest(photoName: string, userNote?: string): Promise<PhotoIngestResult> {
  const dataUri = await photoDataUri(photoName);
  const v = await describeImage(dataUri);

  const selfId = await ensureSelf();
  const parts = [v.description];
  if (v.people.length) parts.push(`People: ${v.people.join(", ")}`);
  if (userNote?.trim()) parts.push(`Owner's note: ${userNote.trim()}`);
  const body = parts.join("\n\n");

  const [vec] = await embed([`${v.caption}. ${v.description} ${userNote ?? ""}`.trim()]);
  const nodeId = await createNode(
    {
      type: "memory",
      title: v.caption,
      body,
      summary: v.description.slice(0, 200),
      sensitivity: "private",
      properties: { kind: "photo", photo: photoName, people: v.people, question: v.question },
      confidence: 0.85,
      salience: 0.6,
      embedding: vec,
    },
    "owner",
  );
  await upsertEdge({ src: nodeId, dst: selfId, type: "relates_to", weight: 0.7, rationale: "A photo from the owner's life." });

  // ── Entity linking: pull NAMED people/places/orgs (names come from the owner's note;
  // never invent), upsert them (dedup-aware, so recurring faces/places fold into one node),
  // and connect the photo to each. This is how photos become part of the connected graph. ──
  let linked = 0;
  const namedPersons: { id: string; name: string }[] = [];
  try {
    const ents = await completeJSON({
      schema: EntitySchema,
      system:
        "From a photo's description and the owner's note, extract entities that are clearly NAMED or unmistakably identified. " +
        "people = named individuals (names come from the owner's note — NEVER invent a name; skip 'a man'/'a friend'). " +
        "places = named or recognizable locations (cities, landmarks, venues). orgs = named organisations/brands. " +
        "Return ONLY things explicitly named; empty arrays when nothing is named.",
      prompt: `Photo: ${v.caption}\n${v.description}\nPeople seen: ${v.people.join(", ") || "—"}\nOwner's note: ${userNote ?? "—"}\n\nReturn {"people":[],"places":[],"orgs":[]}.`,
      model: "fast",
      maxTokens: 300,
    });
    const groups: { items: string[]; type: NodeType }[] = [
      { items: ents.people, type: "person" },
      { items: ents.places, type: "place" },
      { items: ents.orgs, type: "org" },
    ];
    for (const g of groups) {
      for (const raw of g.items) {
        const name = raw.trim().slice(0, 80);
        if (!name) continue;
        const [vec] = await embed([name]);
        const { id: entId } = await mergeOrInsertAtom(
          { type: g.type, title: name, confidence: 0.8, embedding: vec },
          "owner",
        );
        await upsertEdge({ src: nodeId, dst: entId, type: "mentions", weight: 0.7, rationale: "Appears in a photo." });
        if (g.type === "person") namedPersons.push({ id: entId, name });
        linked++;
      }
    }
  } catch {
    /* entity linking is best-effort — a failure never blocks the photo memory */
  }

  // ── Face clustering: recognise recurring people across photos by appearance signature.
  // We assert a person-link only on a high match (labelled + reviewable); a moderate match,
  // or a recurring-but-unnamed person, becomes a clarifying question instead of a wrong claim.
  let faceQuestion: string | null = null;
  try {
    const faces = await recordPhotoFaces(nodeId, v.faces);
    // The owner named exactly one person and there's exactly one face → name that cluster.
    if (namedPersons.length === 1 && v.faces.length === 1) {
      await tagPhotoFace(nodeId, namedPersons[0].id);
    }
    for (const f of faces) {
      if (f.recognise && f.personNodeId && !namedPersons.some((p) => p.id === f.personNodeId)) {
        await upsertEdge({
          src: nodeId,
          dst: f.personNodeId,
          type: "mentions",
          weight: 0.4,
          confidence: 0.5,
          rationale: `Recognised by appearance${f.personName ? ` as ${f.personName}` : ""} (review if wrong).`,
        });
        linked++;
      } else if (f.personName && !namedPersons.length && !faceQuestion) {
        faceQuestion = `Is the person in this photo ${f.personName}?`;
      } else if (f.seenBefore > 0 && !f.personNodeId && !namedPersons.length && !faceQuestion) {
        faceQuestion = "I've seen this person in your photos before — who are they?";
      }
    }
  } catch {
    /* face clustering is best-effort — never blocks the photo memory */
  }

  // Prefer the vision model's own question; otherwise surface a face-recognition question.
  const question = v.question ?? faceQuestion;
  if (!v.question && faceQuestion) {
    await db
      .update(nodes)
      .set({ properties: { kind: "photo", photo: photoName, people: v.people, question } })
      .where(eq(nodes.id, nodeId));
  }

  await recordActivity({ action: "photo_ingest", nodeId, actor: "owner", detail: { caption: v.caption, question, linked } });

  return { nodeId, caption: v.caption, question, linked };
}
