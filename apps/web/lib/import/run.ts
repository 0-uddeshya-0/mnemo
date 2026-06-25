/**
 * Distill a parsed archive into the graph. The LLM reads batches of the owner's exported
 * material and keeps only the SIGNAL — experiences, turning points, beliefs, interests —
 * dropping the noise (smalltalk, logistics, one-liners). Each kept item becomes a dated
 * node. Bounded work (caps batches + nodes) so a huge export can't run away on the local model.
 */
import { z } from "zod";
import { completeJSON } from "@/lib/llm";
import { embed } from "@/lib/embeddings";
import { createNode, recordActivity } from "@/lib/graph/store";
import type { NodeType } from "@/lib/graph/constants";
import type { ParsedArchive, ImportItem } from "@/lib/import/parse";

const ALLOWED: NodeType[] = ["memory", "event", "belief", "interest", "trait", "note", "goal"];

const DistillSchema = z.object({
  entries: z
    .array(
      z.object({
        date: z.string().nullable().default(null),
        type: z.string().default("memory"),
        title: z.string(),
        body: z.string().default(""),
      }),
    )
    .default([]),
});

export interface ImportResult {
  source: string;
  kind: string;
  total: number;
  created: number;
}

function clean(items: ImportItem[]): ImportItem[] {
  const seen = new Set<string>();
  const out: ImportItem[] = [];
  for (const it of items) {
    const t = it.text.replace(/\s+/g, " ").trim();
    if (t.length < 25) continue; // drop one-liners / noise
    const key = t.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue; // drop near-duplicates
    seen.add(key);
    out.push({ ...it, text: t.length > 1200 ? t.slice(0, 1200) : t });
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runArchiveImport(
  parsed: ParsedArchive,
  source: string,
  opts: { maxNodes?: number; maxBatches?: number } = {},
): Promise<ImportResult> {
  const items = clean(parsed.items);
  const maxNodes = opts.maxNodes ?? 120;
  const maxBatches = opts.maxBatches ?? 40;
  // Chats/tweets are short + many → bigger batches; journals/notes are dense → small batches.
  const batchSize = parsed.kind === "whatsapp" || parsed.kind === "twitter" ? 25 : 8;
  const groups = chunk(items, batchSize).slice(0, maxBatches);

  let created = 0;
  for (const g of groups) {
    if (created >= maxNodes) break;
    const context = g
      .map((x, i) => `[${i}]${x.date ? ` (${x.date})` : ""}${x.author ? ` ${x.author}:` : ""} ${x.text}`)
      .join("\n");
    let distilled;
    try {
      distilled = await completeJSON({
        schema: DistillSchema,
        system:
          `You are filling the owner's second brain from their exported ${source}. From these entries, keep ONLY the meaningful signal about who they are and what they've lived — real experiences, turning points, beliefs, interests, relationships, growth. ` +
          "Ruthlessly drop noise: smalltalk, logistics, jokes-in-passing, anything forgettable. Don't invent; prefer their own words. " +
          "For each kept item return {date: ISO date or null, type: one of [memory,event,belief,interest,trait,note,goal], title: <=8 words, body: 1-3 sentences in first person}. " +
          "Return FEW, high-quality entries (often 0-3 per batch). Empty is fine when nothing matters.",
        prompt: `Source: ${source}\n\nEntries:\n${context}\n\nReturn {"entries":[...]}.`,
        model: "fast",
        maxTokens: 900,
      });
    } catch {
      continue; // a bad batch never sinks the whole import
    }

    for (const e of distilled.entries) {
      if (created >= maxNodes) break;
      const title = e.title.trim().slice(0, 140);
      if (!title) continue;
      const type = (ALLOWED as string[]).includes(e.type) ? (e.type as NodeType) : "memory";
      const body = e.body.trim();
      try {
        const [vec] = await embed([`${title}. ${body}`]);
        await createNode(
          {
            type,
            title,
            body: body || null,
            summary: body ? body.slice(0, 200) : null,
            confidence: 0.75,
            salience: 0.55,
            properties: { source, ...(e.date ? { date: e.date } : {}) },
            embedding: vec,
          },
          "agent",
        );
        created++;
      } catch {
        /* skip a node that fails to embed/insert */
      }
    }
  }

  await recordActivity({ action: "archive_import", actor: "owner", detail: { source, kind: parsed.kind, created, total: items.length } });
  return { source, kind: parsed.kind, total: items.length, created };
}
