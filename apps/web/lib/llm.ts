/**
 * The single gateway to the LLM. Talks to OpenRouter's OpenAI-compatible chat endpoint
 * over fetch (no SDK dependency), so any OpenRouter model works via env. Every JSON output
 * is instructed → extracted → Zod-validated → repaired once if malformed; a model that
 * returns garbage twice throws rather than corrupting the graph.
 */
import { z } from "zod";
import { env, isLocalLLM, requireEnv } from "@/lib/env";

export type ModelChoice = "fast" | "deep";

/** The ordered fallback chain for a model choice (comma-separated env, primary first). */
function modelChain(choice: ModelChoice = "fast"): string[] {
  const raw = choice === "deep" && env.LLM_MODEL_DEEP ? env.LLM_MODEL_DEEP : env.LLM_MODEL;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompleteTextArgs {
  system?: string;
  messages: ChatMessage[];
  model?: ModelChoice;
  maxTokens?: number;
  temperature?: number;
  /** Override the default per-request timeout (ms) — bump it for slow background syntheses. */
  timeoutMs?: number;
}

// A hard per-request timeout means a stuck model fails fast and the chain moves on. A local 7B
// is far slower than a cloud endpoint — a cold model load or a big agent prompt can take a
// couple of minutes — so give LOCAL calls much more headroom before aborting (cloud stays
// tight). Slow background tasks (persona, synthesis) can still pass an even larger timeoutMs.
function defaultTimeoutMs(): number {
  return isLocalLLM() ? 180_000 : 60_000;
}

async function callModel(
  model: string,
  messages: ChatMessage[],
  args: CompleteTextArgs,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? defaultTimeoutMs());
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        // A local Ollama endpoint ignores the bearer token, so don't make a now-unused
        // OpenRouter key a hard requirement that bricks the whole brain. Cloud still requires it.
        authorization: `Bearer ${env.OPENROUTER_API_KEY || (isLocalLLM() ? "ollama" : requireEnv("OPENROUTER_API_KEY"))}`,
        "content-type": "application/json",
        "http-referer": env.APP_URL,
        "x-title": "Mnemosyne",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: args.temperature ?? 0.2,
        max_tokens: args.maxTokens ?? 2048,
        // Free reasoning models otherwise burn the token budget "thinking" (and leak it
        // into content) — we want the direct answer/JSON. Ignored by non-reasoning models.
        reasoning: { enabled: false },
        // Keep the local text model resident between calls so the agent's multi-step loop
        // doesn't pay a cold reload each turn. (Vision is unloaded separately after each use.)
        ...(isLocalLLM() ? { keep_alive: "30m" } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("empty response");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Low-level chat with automatic fallback: try each model in the chain until one returns
 * usable content. Keeps Mnemosyne working (and free) when a model is rate-limited or down.
 */
async function chat(args: CompleteTextArgs): Promise<string> {
  const messages: ChatMessage[] = args.system
    ? [{ role: "system", content: args.system }, ...args.messages]
    : args.messages;

  const chain = modelChain(args.model);
  const errors: string[] = [];
  for (const model of chain) {
    try {
      return await callModel(model, messages, args);
    } catch (err) {
      errors.push(`${model} → ${(err as Error).message}`);
    }
  }
  throw new Error(`All LLM models failed:\n${errors.join("\n")}`);
}

/** Plain-text completion (used by the Ask RAG chat). */
export async function completeText(args: CompleteTextArgs): Promise<string> {
  return (await chat({ ...args, temperature: args.temperature ?? 0.7, maxTokens: args.maxTokens ?? 1024 })).trim();
}

interface CompleteJSONArgs<S extends z.ZodTypeAny> {
  /** Zod schema the output must satisfy. */
  schema: S;
  /** System prompt describing the task + the exact JSON shape expected. */
  system: string;
  /** The user content (the data to operate on). */
  prompt: string;
  model?: ModelChoice;
  maxTokens?: number;
  temperature?: number;
  /** Override the per-request abort timeout (ms). Bump it for heavy local multi-step calls. */
  timeoutMs?: number;
}

const JSON_RULES =
  "\n\nRespond with ONLY a single valid JSON value. No prose, no explanation, no markdown code fences. Do not wrap it in ```.";

/**
 * Structured completion: returns a value validated against `schema`. One automatic
 * repair retry on malformed/invalid output, then it throws.
 */
export async function completeJSON<S extends z.ZodTypeAny>(
  args: CompleteJSONArgs<S>,
): Promise<z.infer<S>> {
  const system = args.system + JSON_RULES;
  const first = await chat({
    system,
    messages: [{ role: "user", content: args.prompt }],
    model: args.model,
    maxTokens: args.maxTokens,
    temperature: args.temperature ?? 0.2,
    timeoutMs: args.timeoutMs,
  });

  const firstParsed = tryParseAndValidate(first, args.schema);
  if (firstParsed.ok) return firstParsed.value;

  // ── one repair retry: hand the model its own bad output + the error ──────
  const repair = await chat({
    system,
    messages: [
      { role: "user", content: args.prompt },
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          "That was not valid against the required schema. Error:\n" +
          firstParsed.error +
          "\n\nReturn the corrected JSON only.",
      },
    ],
    model: args.model,
    maxTokens: args.maxTokens,
    temperature: 0,
    timeoutMs: args.timeoutMs,
  });

  const repaired = tryParseAndValidate(repair, args.schema);
  if (repaired.ok) return repaired.value;

  throw new Error(
    `LLM JSON output failed validation after one repair retry: ${repaired.error}\n--- raw ---\n${repair.slice(0, 800)}`,
  );
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function tryParseAndValidate<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
): ParseResult<z.infer<S>> {
  const json = extractJSON(raw);
  if (json === null) return { ok: false, error: "No JSON object/array found in output." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${(e as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, value: result.data };
}

/** Pull the first balanced JSON object or array out of a possibly-noisy string. */
function extractJSON(raw: string): string | null {
  // Reasoning models (e.g. Nemotron) may prepend a <think>…</think> block.
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // strip ```json ... ``` fences if present
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();

  const start = s.search(/[[{]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
