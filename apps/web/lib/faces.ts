/**
 * Person clustering across photos — without biometric face models (kept off this 16GB Mac on
 * purpose). MNEMO's vision model writes a short *appearance signature* per visible person; we
 * embed it and cluster against people seen before. Once you name someone, future close matches
 * can be recognised. We never silently assert identity from appearance — a strong match becomes
 * a low-confidence, clearly-labelled link or a question; names always come from you.
 */
import { sql } from "drizzle-orm";
import { db, toVectorLiteral } from "@/lib/db";
import { embed } from "@/lib/embeddings";

// Appearance signatures from the vision model are textual, so same-person paraphrases land
// around ~0.85–0.92 cosine while different people sit far lower (~0.3–0.6) — a wide margin.
const SUGGEST_COSINE = 0.82; // "this might be the same person" → ask the owner
const RECOGNISE_COSINE = 0.9; // strong enough to add a low-confidence, labelled, reviewable link

export interface FaceMatch {
  signature: string;
  /** A named person this face closely matches, if any (the strongest such match). */
  personNodeId: string | null;
  personName: string | null;
  cosine: number; // best similarity to any prior face
  recognise: boolean; // ≥ RECOGNISE_COSINE and tied to a named person
  seenBefore: number; // how many prior faces it clusters with (named or not)
}

/** Record the people seen in a photo, cluster them, and report any (named) matches. */
export async function recordPhotoFaces(photoNodeId: string, signatures: string[]): Promise<FaceMatch[]> {
  const out: FaceMatch[] = [];
  for (const raw of signatures) {
    const signature = raw.trim().slice(0, 300);
    if (!signature) continue;
    const [vec] = await embed([signature]);
    let personNodeId: string | null = null;
    let personName: string | null = null;
    let cosine = 0;
    let seenBefore = 0;

    if (vec) {
      const lit = toVectorLiteral(vec);
      const near = (await db.execute(sql`
        select f.person_node_id, n.title as person_name, 1 - (f.embedding <=> ${lit}::vector) as cos
        from photo_faces f
        left join nodes n on n.id = f.person_node_id
        where f.embedding is not null and f.photo_node_id <> ${photoNodeId}
        order by f.embedding <=> ${lit}::vector
        limit 5
      `)) as unknown as Array<{ person_node_id: string | null; person_name: string | null; cos: number }>;

      const strong = near.filter((n) => Number(n.cos) >= SUGGEST_COSINE);
      seenBefore = strong.length;
      const named = strong.find((n) => n.person_node_id);
      if (named) {
        personNodeId = named.person_node_id;
        personName = named.person_name;
        cosine = Number(named.cos);
      } else if (strong.length) {
        cosine = Number(strong[0].cos);
      }

      await db.execute(sql`
        insert into photo_faces (photo_node_id, person_node_id, signature, embedding)
        values (${photoNodeId}, ${personNodeId}, ${signature}, ${lit}::vector)
      `);
    }

    out.push({
      signature,
      personNodeId,
      personName,
      cosine,
      recognise: !!personNodeId && cosine >= RECOGNISE_COSINE,
      seenBefore,
    });
  }
  return out;
}

/** When the owner names the single person in a photo, tag that photo's face with them, so the
 *  cluster becomes recognisable later. Only safe for a single-face photo (caller enforces). */
export async function tagPhotoFace(photoNodeId: string, personNodeId: string): Promise<void> {
  await db.execute(sql`
    update photo_faces set person_node_id = ${personNodeId}
    where photo_node_id = ${photoNodeId} and person_node_id is null
  `);
}
