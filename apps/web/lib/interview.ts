/**
 * The "Know Me" onboarding interview engine. Builds the Self layer block by block as a
 * chat. Each phase opens with a copy-exact question (§6.4); the LLM generates adaptive
 * follow-ups informed by the Self-subgraph so far. Answers are processed as owner-authored
 * (confidence 1.0), wiring beliefs/interests/traits/goals/memories/people to `self`.
 */
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { interviewState, nodes } from "@/lib/db/schema";
import { completeJSON } from "@/lib/llm";
import { embed } from "@/lib/embeddings";
import { createNode, upsertEdge } from "@/lib/graph/store";
import { adjudicateLinks } from "@/lib/pipeline/link";
import { ensureSelf } from "@/lib/graph/self";
import {
  INTERVIEW_PHASES,
  type EdgeType,
  type InterviewPhase,
  type NodeType,
  type Sensitivity,
} from "@/lib/graph/constants";


export interface DeckQuestion {
  id: string;
  phase: InterviewPhase;
  kind: "text" | "single" | "multi";
  question: string;
  options?: string[];
  note?: string;
}

/**
 * The structured question deck — asked (unanswered-first) before MNEMO drifts into adaptive
 * follow-ups. Grounded in established frameworks: Big Five / BFI (personality), Schwartz's Basic
 * Values via PVQ-style "portraits", narrative identity / life-story (McAdams), and attachment —
 * blended with concrete facts (family, relationships, place, hobbies) and a self-SWOT. A mix of
 * pick-one, pick-many, and open questions so it's quick to answer but still revealing.
 */
const L = ["Very much like me", "Somewhat like me", "A little like me", "Not like me"];
export const QUESTION_DECK: DeckQuestion[] = [
  // ── concrete grounding ──
  { id: "loc", phase: "identity", kind: "text", question: "Where are you based right now — city and country?" },
  { id: "ident", phase: "identity", kind: "text", question: "In a sentence or two, who are you when you're not performing for anyone?" },
  { id: "fam", phase: "background", kind: "text", question: "Who's in your immediate family, and how would you describe each of them in a few words?" },
  { id: "relstatus", phase: "relationships", kind: "single", question: "Your relationship status right now:", options: ["Single", "Dating", "In a committed relationship", "Married / partnered", "It's complicated", "Prefer not to say"] },
  { id: "closepeople", phase: "relationships", kind: "text", question: "Who are the 3–5 people closest to you, and what does each mean to you?" },
  { id: "friendstyle", phase: "relationships", kind: "single", question: "Your friendships are mostly:", options: ["A few deep, lifelong ones", "A wide circle of many", "A few close + many acquaintances", "Mostly solitary by choice"] },
  { id: "hobbies", phase: "interests", kind: "multi", question: "Which of these are genuinely yours? (pick any)", options: ["Reading", "Gaming", "Music / playing an instrument", "Sport / fitness", "Cooking", "Art / design", "Coding / building", "Writing", "Travel", "Anime / film / TV", "Nature / outdoors", "Photography"] },
  { id: "hobbies2", phase: "interests", kind: "text", question: "What could you talk about for an hour without getting bored — and what's the newest thing that's pulled you in?" },

  // ── Big Five (BFI-style, pick-one) ──
  { id: "b5_extra", phase: "personality", kind: "single", question: "You walk into a room full of strangers. You usually:", options: ["Get energised and work the room", "Find one person and go deep", "Hang back and observe first", "Look for the exit"], note: "extraversion" },
  { id: "b5_open", phase: "personality", kind: "single", question: "A free weekend is best spent:", options: ["Trying something brand new", "A favourite routine you love", "Plans with people", "Quiet time alone to recharge"], note: "openness" },
  { id: "b5_consc", phase: "personality", kind: "single", question: "Plans and deadlines are, to you:", options: ["Sacred — I plan ahead", "Useful guidelines", "A bit stressful", "Made to be broken"], note: "conscientiousness" },
  { id: "b5_agree", phase: "personality", kind: "single", question: "In a disagreement you tend to:", options: ["Seek harmony / smooth it over", "Argue your point firmly", "Go quiet and withdraw", "Depends entirely on who it's with"], note: "agreeableness" },
  { id: "b5_neuro", phase: "personality", kind: "single", question: "When stress hits, you usually:", options: ["Stay calm and steady", "Feel it intensely but push through", "Spiral a bit then recover", "Shut down / avoid"], note: "neuroticism" },
  { id: "b5_decide", phase: "ways_of_thinking", kind: "single", question: "When you make a hard decision, you lean most on:", options: ["Logic and analysis", "Your values / what feels right", "Gut instinct", "Advice from people you trust"] },

  // ── Schwartz values (PVQ-style portraits, Likert) ──
  { id: "v_stim", phase: "values", kind: "single", question: "“Someone who loves adventure and taking risks; an exciting life matters to them.” How like you is this?", options: L, note: "stimulation" },
  { id: "v_benev", phase: "values", kind: "single", question: "“Someone for whom caring for the people around them comes first.” How like you?", options: L, note: "benevolence" },
  { id: "v_achieve", phase: "values", kind: "single", question: "“Someone who wants to be very successful and have their achievements recognised.” How like you?", options: L, note: "achievement" },
  { id: "v_selfdir", phase: "values", kind: "single", question: "“Someone who insists on making their own choices and depends on no one.” How like you?", options: L, note: "self-direction" },
  { id: "v_security", phase: "values", kind: "single", question: "“Someone for whom safety, stability, and order matter most.” How like you?", options: L, note: "security" },
  { id: "v_nonneg", phase: "values", kind: "text", question: "What's one thing you'd refuse to compromise on, even if it cost you?" },

  // ── attachment / relationships ──
  { id: "attach", phase: "relationships", kind: "single", question: "In close relationships, you tend to:", options: ["Trust and open up easily", "Want closeness but fear it won't last", "Value independence above all", "Keep some distance to stay safe"], note: "attachment style" },

  // ── narrative identity / life story (open) ──
  { id: "highpoint", phase: "experiences", kind: "text", question: "Tell me about a high point — a moment you felt most alive or most yourself." },
  { id: "lowpoint", phase: "experiences", kind: "text", question: "And a low point — a hard chapter that shaped you. What happened, and what did it leave you with?" },
  { id: "turning", phase: "turning_points", kind: "text", question: "A fork in the road where, had you chosen differently, you'd be a different person today?" },
  { id: "changed", phase: "growth", kind: "text", question: "Something you believe or do now that you didn't three years ago — what moved you?" },

  // ── ways of thinking, daily life ──
  { id: "think", phase: "ways_of_thinking", kind: "text", question: "When you're working something hard out, what does your thinking actually look like?" },
  { id: "energy", phase: "daily_life", kind: "single", question: "You're most clear-headed and productive:", options: ["Early morning", "Midday", "Late evening", "Deep night"] },
  { id: "day", phase: "daily_life", kind: "text", question: "Walk me through an ordinary day that feels like *your* life — the rhythms and small rituals." },

  // ── self-SWOT ──
  { id: "swot_s", phase: "personality", kind: "text", question: "SWOT — Strengths: what are you genuinely good at, that others rely on you for?" },
  { id: "swot_w", phase: "growth", kind: "text", question: "SWOT — Weaknesses: where do you keep tripping over yourself?" },
  { id: "swot_o", phase: "goals", kind: "text", question: "SWOT — Opportunities: what's open to you right now that you could run at?" },
  { id: "swot_t", phase: "goals", kind: "text", question: "SWOT — Threats: what's most likely to get in your way?" },

  // ── goals, creative self ──
  { id: "goal", phase: "goals", kind: "text", question: "What are you quietly building toward — the thing you'd regret not attempting?" },
  { id: "creative", phase: "creative_self", kind: "text", question: "What have you made — written, built, drawn, anything — that felt most like *you*?" },
  { id: "legacy", phase: "identity", kind: "text", question: "When it's all said and done, what do you hope people say about you?" },
];

export interface QAEntry {
  phase: InterviewPhase;
  question: string;
  answer: string;
}

export type QuestionKind = "text" | "single" | "multi";

export interface NextQuestion {
  phase: InterviewPhase;
  question: string;
  drip: boolean;
  /** "text" = free-form; "single" = pick one (radio); "multi" = pick several (checkboxes). */
  kind?: QuestionKind;
  options?: string[];
  /** A short helper line shown under the question. */
  note?: string;
}

export interface CapturedAtom {
  id: string;
  type: NodeType;
  title: string;
}

// ── State helpers ───────────────────────────────────────────────────────────
export async function ensureInterviewState() {
  const [row] = await db.select().from(interviewState).limit(1);
  if (row) return row;
  const [created] = await db.insert(interviewState).values({}).returning();
  if (!created) throw new Error("could not create interview_state");
  return created;
}

function answeredOf(row: { answered: unknown[] }): QAEntry[] {
  return (row.answered as QAEntry[]) ?? [];
}

function answersInPhase(answered: QAEntry[], phase: InterviewPhase): number {
  return answered.filter((a) => a.phase === phase).length;
}

/** Completeness = how much of the structured deck has been answered (drip answers count too). */
export function computeCompleteness(answered: QAEntry[]): number {
  const done = new Set(answered.map((a) => a.question));
  const deckDone = QUESTION_DECK.filter((q) => done.has(q.question)).length;
  return Math.min(100, Math.round((deckDone / QUESTION_DECK.length) * 100));
}

/** The first deck question they haven't answered yet (in order), or null when the deck is done. */
function nextDeckQuestion(answered: QAEntry[]): DeckQuestion | null {
  const done = new Set(answered.map((a) => a.question));
  return QUESTION_DECK.find((q) => !done.has(q.question)) ?? null;
}

/** Titles of the owner's current self-layer atoms, for prompting context. */
async function getSelfContext(limit = 24): Promise<string> {
  const rows = await db
    .select({ type: nodes.type, title: nodes.title })
    .from(nodes)
    .where(
      and(
        inArray(nodes.type, ["belief", "interest", "trait", "goal", "memory", "concept"]),
        eq(nodes.status, "active"),
      ),
    )
    .orderBy(desc(nodes.salience))
    .limit(limit);
  if (!rows.length) return "(nothing captured yet)";
  return rows.map((r) => `- (${r.type}) ${r.title}`).join("\n");
}

// ── Cold-start reflection (§6.3) ────────────────────────────────────────────
export async function coldStartReflection(): Promise<string | null> {
  const rows = await db
    .select({ title: nodes.title })
    .from(nodes)
    .where(and(inArray(nodes.type, ["interest", "concept"]), eq(nodes.status, "active")))
    .orderBy(desc(nodes.salience))
    .limit(6);
  if (rows.length < 3) return null;
  const themes = rows.slice(0, 3).map((r) => r.title);
  return `From what you've already saved, you seem drawn to ${themes
    .slice(0, -1)
    .join(", ")} and ${themes[themes.length - 1]}. I'll keep that in mind — tell me if I've got you wrong.`;
}

// ── Adaptive follow-up generation ───────────────────────────────────────────
async function generateDripQuestion(selfContext: string): Promise<NextQuestion> {
  const r = await completeJSON({
    schema: z.object({ phase: z.enum(INTERVIEW_PHASES), question: z.string() }),
    system:
      "You maintain an ongoing, gentle interview with one person. Pick the area most worth deepening " +
      "and ask ONE fresh question that resurfaces or extends something — never repetitive.",
    prompt: `What I know about them:\n${selfContext}\n\nReturn {"phase": <one phase>, "question": "…"}.`,
    model: "fast",
    maxTokens: 256,
    temperature: 0.9,
  });
  return { phase: r.phase, question: r.question.trim(), drip: true };
}

/** Determine the next question to ask given current state (may call the LLM). */
async function computeNextQuestion(row: {
  phase: InterviewPhase;
  answered: unknown[];
  nextQuestions: unknown[];
}): Promise<NextQuestion> {
  const answered = answeredOf(row);
  // Walk the structured deck first (unanswered, in order) — concrete + MCQ + open.
  const deckQ = nextDeckQuestion(answered);
  if (deckQ) {
    return {
      phase: deckQ.phase,
      question: deckQ.question,
      kind: deckQ.kind,
      options: deckQ.options,
      note: deckQ.note,
      drip: false,
    };
  }
  // Deck complete → adaptive, curiosity-driven follow-ups forever.
  return generateDripQuestion(await getSelfContext());
}

// ── Owner-signal extraction from an answer ──────────────────────────────────
const SignalSchema = z.object({
  beliefs: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
  traits: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  memories: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
});

const SIGNAL_TO_TYPE: Record<keyof z.infer<typeof SignalSchema>, NodeType> = {
  beliefs: "belief",
  interests: "interest",
  traits: "trait",
  goals: "goal",
  memories: "memory",
  people: "person",
};
const SIGNAL_TO_EDGE: Record<keyof z.infer<typeof SignalSchema>, EdgeType> = {
  beliefs: "believes",
  interests: "interested_in",
  traits: "relates_to",
  goals: "aspires_to",
  memories: "relates_to",
  people: "relates_to",
};

async function processAnswer(entry: QAEntry): Promise<CapturedAtom[]> {
  const selfId = await ensureSelf();

  // 1) the answer itself becomes a note source (memory-grade privacy)
  const noteBody = `**Q:** ${entry.question}\n\n**A:** ${entry.answer}`;
  const [noteVec] = await embed([`${entry.phase} ${entry.answer}`]);
  const noteId = await createNode(
    {
      type: "note",
      title: `Interview · ${entry.phase}`,
      body: noteBody,
      summary: entry.answer.slice(0, 200),
      properties: { interviewPhase: entry.phase, question: entry.question },
      confidence: 1,
      embedding: noteVec,
    },
    "owner",
  );
  await upsertEdge({ src: noteId, dst: selfId, type: "learned_from", weight: 0.9, rationale: "Interview answer." });

  // 2) extract owner signals
  const signals = await completeJSON({
    schema: SignalSchema,
    system:
      "Extract first-person signals from one interview answer for a personal knowledge graph. " +
      "Only include things the person clearly expresses about themselves. Keep each item a short noun phrase. " +
      "Empty arrays are fine. Keys: beliefs, interests, traits, goals, memories (a specific formative moment), people (names they mention).",
    prompt: `Phase: ${entry.phase}\nQ: ${entry.question}\nA: ${entry.answer}`,
    model: "fast",
    maxTokens: 700,
  });

  const flat: { kind: keyof z.infer<typeof SignalSchema>; title: string }[] = [];
  (Object.keys(SIGNAL_TO_TYPE) as (keyof z.infer<typeof SignalSchema>)[]).forEach((kind) => {
    for (const title of signals[kind]) if (title.trim()) flat.push({ kind, title: title.trim() });
  });
  if (flat.length === 0) return [];

  const vecs = await embed(
    flat.map((f) => f.title),
  );

  const atoms: CapturedAtom[] = [];
  for (let i = 0; i < flat.length; i++) {
    const f = flat[i]!;
    const type = SIGNAL_TO_TYPE[f.kind];
    const sensitivity: Sensitivity = type === "memory" ? "private" : "normal";
    const id = await createNode(
      { type, title: f.title, confidence: 1, sensitivity, sourceId: noteId, embedding: vecs[i] },
      "owner",
    );
    await upsertEdge({
      src: selfId,
      dst: id,
      type: SIGNAL_TO_EDGE[f.kind],
      weight: 0.9,
      confidence: 1,
      rationale: "Stated during onboarding.",
    });
    await upsertEdge({ src: id, dst: noteId, type: "learned_from", weight: 0.7, rationale: "Surfaced from an interview answer." });
    atoms.push({ id, type, title: f.title });
  }

  // light linking for the new conceptual atoms (best-effort)
  for (const atom of atoms.filter((a) => a.type === "belief" || a.type === "interest")) {
    try {
      await adjudicateLinks(atom.id);
    } catch {
      /* non-fatal */
    }
  }

  return atoms;
}

// ── Big-Five personality inference (after the personality phase) ────────────
export async function inferPersonality(): Promise<void> {
  const row = await ensureInterviewState();
  const answered = answeredOf(row);
  const personalityAnswers = answered.filter((a) => a.phase === "personality" || a.phase === "ways_of_thinking");
  if (personalityAnswers.length === 0) return;

  const result = await completeJSON({
    schema: z.object({
      traits: z
        .array(z.object({ trait: z.string(), level: z.string(), evidence: z.string() }))
        .default([]),
    }),
    system:
      "From the person's own words, estimate Big-Five-style personality traits. Return up to 5 traits, " +
      "each {trait (e.g. 'Openness'), level (e.g. 'high'), evidence (one line grounded in what they said)}. " +
      "These are INFERENCES, not assertions.",
    prompt: personalityAnswers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n"),
    model: "fast",
    maxTokens: 700,
  });
  if (result.traits.length === 0) return;

  const selfId = await ensureSelf();
  const titles = result.traits.map((t) => `${t.level} ${t.trait}`);
  const vecs = await embed(titles);
  for (let i = 0; i < result.traits.length; i++) {
    const t = result.traits[i]!;
    const id = await createNode(
      {
        type: "trait",
        title: titles[i]!,
        body: t.evidence,
        summary: t.evidence,
        confidence: 0.6,
        properties: { inferred: true, bigFive: t.trait },
        embedding: vecs[i],
      },
      "llm",
    );
    await upsertEdge({
      src: selfId,
      dst: id,
      type: "relates_to",
      weight: 0.6,
      confidence: 0.6,
      rationale: `Inferred from onboarding: ${t.evidence}`,
    });
  }
}

// ── Public surface used by server actions ───────────────────────────────────
export interface InterviewStart {
  coldStart: string | null;
  next: NextQuestion;
  completeness: number;
}

export async function startInterview(): Promise<InterviewStart> {
  await ensureSelf();
  const row = await ensureInterviewState();
  const coldStart = answeredOf(row).length === 0 ? await coldStartReflection() : null;
  const next = await computeNextQuestion(row);
  return { coldStart, next, completeness: computeCompleteness(answeredOf(row)) };
}

export interface AnswerResult {
  atoms: CapturedAtom[];
  next: NextQuestion;
  completeness: number;
}

export async function answerInterview(
  phase: InterviewPhase,
  question: string,
  answer: string,
): Promise<AnswerResult> {
  const row = await ensureInterviewState();
  const entry: QAEntry = { phase, question, answer };
  const atoms = await processAnswer(entry);

  const prev = answeredOf(row);
  const answered = [...prev, entry];
  const completeness = computeCompleteness(answered);
  await db
    .update(interviewState)
    .set({ phase, answered, nextQuestions: [], completeness })
    .where(eq(interviewState.id, row.id));

  // Infer Big-Five once enough personality answers are in (fire-and-forget, once).
  if (
    phase === "personality" &&
    answersInPhase(prev, "personality") < 5 &&
    answersInPhase(answered, "personality") >= 5
  ) {
    inferPersonality().catch((e) => console.error("[interview] personality inference failed:", e));
  }

  const next = await computeNextQuestion({ phase, answered, nextQuestions: [] });
  return { atoms, next, completeness };
}

export async function skipQuestion(phase: InterviewPhase, question: string): Promise<NextQuestion> {
  const row = await ensureInterviewState();
  // Record the skip so the deck moves past it (no extraction).
  const answered = [...answeredOf(row), { phase, question, answer: "(skipped)" }];
  await db
    .update(interviewState)
    .set({ phase, answered, completeness: computeCompleteness(answered) })
    .where(eq(interviewState.id, row.id));
  return computeNextQuestion({ phase, answered, nextQuestions: [] });
}
