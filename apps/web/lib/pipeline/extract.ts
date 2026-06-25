/**
 * Stage 4 — Extract atoms (the LLM). Returns strict JSON validated by the Zod schema
 * from the spec. For long docs we extract per-chunk (capped) then merge + dedupe.
 */
import { z } from "zod";
import { completeJSON } from "@/lib/llm";

export const ExtractionSchema = z.object({
  summary: z.string().default(""),
  concepts: z
    .array(z.object({ title: z.string(), definition: z.string().default("") }))
    .default([]),
  skills: z.array(z.object({ title: z.string(), note: z.string().default("") })).default([]),
  people: z.array(z.object({ name: z.string(), role: z.string().default("") })).default([]),
  orgs: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  quotes: z
    .array(z.object({ text: z.string(), why_notable: z.string().default("") }))
    .default([]),
  themes: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
  owner_signals: z
    .object({
      beliefs: z.array(z.string()).default([]),
      interests: z.array(z.string()).default([]),
      traits: z.array(z.string()).default([]),
      goals: z.array(z.string()).default([]),
    })
    .default({ beliefs: [], interests: [], traits: [], goals: [] }),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const MAX_CHUNKS_FOR_EXTRACTION = 12;

function systemPrompt(ownerAuthored: boolean): string {
  return [
    "You are an information-extraction engine for a single person's knowledge graph.",
    "Read the source text and extract reusable knowledge atoms as JSON with EXACTLY these keys:",
    "summary (1–3 sentences), concepts ([{title, definition}]), skills ([{title, note}]),",
    "people ([{name, role}]), orgs ([string]), places ([string]),",
    "quotes ([{text, why_notable}] — VERBATIM, ≤25 words each, only genuinely notable lines),",
    "themes ([string]), open_questions ([string]),",
    "owner_signals ({beliefs:[string], interests:[string], traits:[string], goals:[string]}).",
    "",
    "Rules:",
    "- Be selective: a few high-signal atoms beat many trivial ones. No sentence-fragment concepts.",
    "- Concepts are reusable ideas with a short definition; skills are capabilities/methods.",
    "- Never fabricate quotes; only include lines that actually appear in the text.",
    ownerAuthored
      ? "- This text IS the owner's own writing. Populate owner_signals with first-person beliefs/interests/traits/goals it reveals."
      : "- This text is something the owner CONSUMED (not their own). Leave ALL owner_signals arrays empty.",
  ].join("\n");
}

async function runOnce(
  system: string,
  title: string,
  text: string,
): Promise<Extraction> {
  return completeJSON({
    schema: ExtractionSchema,
    system,
    prompt: `SOURCE TITLE: ${title}\n\nSOURCE TEXT:\n${text}`,
    model: "fast",
    maxTokens: 2048,
  });
}

export async function extractAtoms(args: {
  title: string;
  chunks: string[];
  ownerAuthored: boolean;
}): Promise<Extraction> {
  const system = systemPrompt(args.ownerAuthored);
  if (args.chunks.length <= 1) {
    return runOnce(system, args.title, args.chunks[0] ?? "");
  }
  const selected = args.chunks.slice(0, MAX_CHUNKS_FOR_EXTRACTION);
  const results: Extraction[] = [];
  for (const chunk of selected) {
    results.push(await runOnce(system, args.title, chunk));
  }
  return mergeExtractions(results);
}

function uniqBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item).toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function mergeExtractions(parts: Extraction[]): Extraction {
  const all = parts;
  const summary = all.map((p) => p.summary).find((s) => s.trim().length > 0) ?? "";
  return {
    summary,
    concepts: uniqBy(all.flatMap((p) => p.concepts), (c) => c.title),
    skills: uniqBy(all.flatMap((p) => p.skills), (s) => s.title),
    people: uniqBy(all.flatMap((p) => p.people), (p) => p.name),
    orgs: [...new Set(all.flatMap((p) => p.orgs).map((o) => o.trim()).filter(Boolean))],
    places: [...new Set(all.flatMap((p) => p.places).map((o) => o.trim()).filter(Boolean))],
    quotes: uniqBy(all.flatMap((p) => p.quotes), (q) => q.text),
    themes: [...new Set(all.flatMap((p) => p.themes).map((t) => t.trim()).filter(Boolean))],
    open_questions: [
      ...new Set(all.flatMap((p) => p.open_questions).map((q) => q.trim()).filter(Boolean)),
    ],
    owner_signals: {
      beliefs: [...new Set(all.flatMap((p) => p.owner_signals.beliefs))],
      interests: [...new Set(all.flatMap((p) => p.owner_signals.interests))],
      traits: [...new Set(all.flatMap((p) => p.owner_signals.traits))],
      goals: [...new Set(all.flatMap((p) => p.owner_signals.goals))],
    },
  };
}
