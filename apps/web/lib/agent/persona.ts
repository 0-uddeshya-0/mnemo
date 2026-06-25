/**
 * The persona model — MNEMO's evolving sense of WHO YOU ARE, so it thinks, talks, and
 * decides in your voice, not a generic assistant's. Synthesized from your own owner-authored
 * content (beliefs, traits, interests, goals, memories, notes, creative work). Stored on the
 * `self` node and versioned in node_versions, so your second self evolves as you do.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { completeText } from "@/lib/llm";
import { ensureSelf, getSelfId } from "@/lib/graph/self";
import { snapshotNodeVersion } from "@/lib/graph/store";
import { maybeDecryptBody } from "@/lib/crypto";
import { getAgentExposure } from "@/lib/settings";

const DEFAULT_PERSONA =
  "We don't know this person well yet — let onboarding and captures fill in who they are. " +
  "Until then, be warm, curious, and careful never to put words in their mouth.";

/** The current persona text the agent operates with. */
export async function getPersona(): Promise<string> {
  const selfId = await getSelfId();
  if (!selfId) return DEFAULT_PERSONA;
  const [self] = await db
    .select({ properties: nodes.properties, body: nodes.body })
    .from(nodes)
    .where(eq(nodes.id, selfId))
    .limit(1);
  const persona = (self?.properties as Record<string, unknown> | undefined)?.persona;
  return typeof persona === "string" && persona.trim() ? persona : DEFAULT_PERSONA;
}

/**
 * (Re)build the persona from everything owner-authored. On a *local* model, your private
 * material shapes the self-model too (it never leaves the Mac) — which is what lets MNEMO
 * actually know your most defining self. On a cloud model, private is excluded unless you've
 * explicitly opted in (governed centrally by getAgentExposure).
 */
export async function buildPersona(): Promise<string> {
  const selfId = await ensureSelf();
  const { exposePrivate } = await getAgentExposure();

  const rows = await db
    .select({
      type: nodes.type,
      title: nodes.title,
      summary: nodes.summary,
      body: nodes.body,
      sensitivity: nodes.sensitivity,
      confidence: nodes.confidence,
    })
    .from(nodes)
    .where(
      and(
        inArray(nodes.type, ["belief", "trait", "interest", "goal", "note", "creative_work", "quote"]),
        eq(nodes.status, "active"),
      ),
    )
    .orderBy(desc(nodes.salience))
    .limit(42);

  const lines: string[] = [];
  for (const r of rows) {
    // Private shapes you — included when inference is local (or explicitly allowed), excluded
    // when it would otherwise be sent to a cloud model. exposePrivate is resolved model-aware.
    if (r.sensitivity === "private" && !exposePrivate) continue;
    // Notes (esp. interview answers) carry the most reasoning signal — keep more of them.
    const limit = r.type === "note" ? 200 : 110;
    const text = r.summary || (await maybeDecryptBody(r.body)) || "";
    lines.push(`- (${r.type}) ${r.title}${text ? ` — ${text.slice(0, limit)}` : ""}`);
  }

  if (lines.length < 3) return getPersona(); // not enough yet to model honestly

  const persona = await completeText({
    system:
      "You write a rich, specific PERSONA brief for an AI that will think, speak, and act AS this person. " +
      "Use ONLY their own material; never invent traits. Be concrete and honest, not flattering. Second person ('you…'). " +
      "Structure it in two clearly-labelled parts:\n" +
      "WHO YOU ARE — voice and tone, core values, what you care about, how you tend to behave and react, recurring themes, blind spots.\n" +
      "HOW YOU THINK — your reasoning style and the way you actually work problems out (analytical vs intuitive, big-picture vs detail, fast vs deliberate, certain vs hedged), how you make decisions and weigh trade-offs, what your underlying intent usually is, and the mental moves you repeat. " +
      "This second part matters most: it's how I reason like you. Keep it tight: 140-200 words total.",
    messages: [{ role: "user", content: `This person, in their own words:\n\n${lines.join("\n")}` }],
    maxTokens: 380,
    temperature: 0.4,
    timeoutMs: 240_000, // background synthesis on the local model is slow on 16GB — give it room
  });

  // snapshot the prior self state, then store the new persona (evolution is reconstructable)
  const [self] = await db.select().from(nodes).where(eq(nodes.id, selfId)).limit(1);
  if (self) await snapshotNodeVersion(self, "Persona updated");
  await db
    .update(nodes)
    .set({
      summary: persona.slice(0, 280),
      properties: { ...((self?.properties as Record<string, unknown>) ?? {}), persona },
    })
    .where(eq(nodes.id, selfId));

  return persona;
}
