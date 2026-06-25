/**
 * Stage 2 — Chunk. ~800-token chunks, 120-token overlap, split on sentence boundaries.
 * Inputs under the threshold skip chunking (the body is the single chunk). Token counts
 * are estimated as chars/4 (good enough for sizing; embeddings handle exact tokenization).
 */
const CHARS_PER_TOKEN = 4;

function estTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function splitSentences(text: string): string[] {
  const rough = text
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  const sentences = (rough ?? [text]).map((s) => s.trim()).filter(Boolean);
  // Hard-split any pathologically long "sentence" (e.g. no punctuation) into windows.
  const maxChars = 800 * CHARS_PER_TOKEN;
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= maxChars) {
      out.push(s);
    } else {
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
    }
  }
  return out;
}

export function chunkText(
  text: string,
  opts: { maxTokens?: number; overlapTokens?: number } = {},
): string[] {
  const maxTokens = opts.maxTokens ?? 800;
  const overlapTokens = opts.overlapTokens ?? 120;
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (estTokens(trimmed) <= maxTokens) return [trimmed];

  const sentences = splitSentences(trimmed);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const t = estTokens(sentence);
    if (currentTokens + t > maxTokens && current.length > 0) {
      chunks.push(current.join(" ").trim());
      // carry an overlap tail
      const tail: string[] = [];
      let tailTokens = 0;
      for (let i = current.length - 1; i >= 0 && tailTokens < overlapTokens; i--) {
        const s = current[i];
        if (!s) continue;
        tail.unshift(s);
        tailTokens += estTokens(s);
      }
      current = tail;
      currentTokens = tailTokens;
    }
    current.push(sentence);
    currentTokens += t;
  }
  if (current.length > 0) chunks.push(current.join(" ").trim());
  return chunks.filter((c) => c.length > 0);
}
