/**
 * Deep research (inspired by Khoj's deep-research, built for MNEMO's local-first reality). A
 * multi-round investigation that runs ASYNC (it's slow on a local 7B) and lands a structured,
 * cited brief in the digest inbox: grounds in what you already know → plans sub-questions →
 * gathers web evidence → synthesizes a brief that ties findings back to YOUR graph.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { completeText, completeJSON } from "@/lib/llm";
import { agentSearch } from "@/lib/agent/api";
import { searchWeb, fetchWeb } from "@/lib/agent/web";
import { getPersona } from "@/lib/agent/persona";
import { recordRun } from "@/lib/agent/runs";
import { db } from "@/lib/db";
import { agentRuns } from "@/lib/db/schema";

export interface DeepResearchResult {
  runId: string;
  answer: string;
}

/** Run a full deep-research pass on a topic and drop the brief in the inbox. */
export async function runDeepResearch(topic: string): Promise<DeepResearchResult> {
  const t = topic.trim().slice(0, 300);

  // 1) Ground in what they already know (so the brief connects, not floats).
  const known = await agentSearch(t, { limit: 8 }).catch(() => []);
  const knownBrief = known.length
    ? known.map((n) => `- (${n.type}) ${n.title}`).join("\n")
    : "(nothing on this yet)";

  // 2) Plan 2–4 sharp sub-questions to investigate.
  const plan = await completeJSON({
    schema: z.object({ questions: z.array(z.string()).min(1).max(4) }),
    system:
      "You plan a focused deep-research investigation. Given a topic and what the owner already knows, produce 2-4 sharp, non-overlapping sub-questions worth researching on the web. English only.",
    prompt: `TOPIC: ${t}\n\nWHAT THEY ALREADY KNOW:\n${knownBrief}\n\nReturn {"questions": [...]}.`,
    model: "fast",
    maxTokens: 300,
    temperature: 0.4,
    timeoutMs: 180_000,
  }).catch(() => ({ questions: [t] }));

  // 3) Gather web evidence per sub-question (bounded: ≤4 questions × 2 sources).
  const blocks: string[] = [];
  for (const q of plan.questions.slice(0, 4)) {
    const hits = await searchWeb(q, 4).catch(() => []);
    const sources: string[] = [];
    for (const h of hits.slice(0, 2)) {
      try {
        const p = await fetchWeb(h.url);
        sources.push(`[${p.title || h.title}](${h.url})\n${p.text.slice(0, 1200)}`);
      } catch {
        /* unreachable source — skip */
      }
    }
    blocks.push(`## ${q}\n${sources.join("\n\n") || "(no readable sources found)"}`);
  }

  // 4) Synthesize a structured, cited brief in their voice, tied back to their graph.
  const answer = await completeText({
    system:
      buildResearchSystem() +
      "\n\nHere is who you are (write in this voice):\n" +
      (await getPersona()).slice(0, 1200),
    messages: [
      {
        role: "user",
        content: `TOPIC: ${t}\n\nWHAT I ALREADY KNOW (my graph — cite these by name where relevant):\n${knownBrief}\n\nWEB EVIDENCE:\n${blocks.join("\n\n")}\n\nWrite the brief now.`,
      },
    ],
    maxTokens: 1100,
    temperature: 0.4,
    timeoutMs: 300_000,
  });

  // 5) Persist to the inbox for review.
  const runId = await recordRun({
    mode: "digest",
    task: `Deep research: ${t}`,
    answer,
    steps: [],
    proposals: [],
    source: "deep_research",
  });
  await db.update(agentRuns).set({ status: "pending_review" }).where(eq(agentRuns.id, runId));
  return { runId, answer };
}

function buildResearchSystem(): string {
  return [
    "You are MNEMO doing DEEP RESEARCH for the owner — their second self, not a generic assistant. Write as 'I/you', warm and sharp.",
    "Produce a tight brief with these sections (use these exact headings):",
    "**TL;DR** — 2-3 sentences.",
    "**Key findings** — the substantive points, each grounded in the web evidence; cite sources as markdown links. Separate what's well-established from what's speculative.",
    "**How this connects to you** — relate findings to the SPECIFIC nodes from my graph above, naming them. Never claim a connection you can't point to.",
    "**Worth exploring next** — 1-3 open questions or threads.",
    "Rules: ground every claim in the evidence or my own knowledge; label inferences as inferences; never fabricate a source or a link. Be honest about gaps. Write in ENGLISH — never Chinese.",
  ].join("\n");
}
