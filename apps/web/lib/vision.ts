/**
 * Local vision — MNEMO's eyes. Sends an uploaded photo to a local Ollama vision model
 * (qwen2.5-VL) and gets back a memory-grade description + any clarifying question. Photos
 * never leave the Mac. Uses the OpenAI-compatible /chat/completions image content shape.
 */
import { env, isLocalLLM } from "@/lib/env";

export interface VisionResult {
  caption: string; // short title
  description: string; // 2–4 sentences
  people: string[]; // generic descriptions, never invented names
  faces: string[]; // per-person appearance signatures (for cross-photo clustering)
  question: string | null; // one clarifying question, or null
}

const PROMPT =
  "This is a photo from the owner's own life — for their personal memory. Describe it faithfully. " +
  "Return STRICT JSON only, no prose:\n" +
  '{"caption": "<=8 word title", "description": "2-4 sentences — who/what is here, the setting, the mood, notable objects", ' +
  '"people": ["generic descriptions only, e.g. \'a young woman\', \'two kids\' — NEVER invent names"], ' +
  '"faces": ["for EACH distinct person visible, a concise appearance signature for recognising them again: apparent age range, presentation, hair (length/colour/style), face shape, glasses/facial hair, and any distinctive feature — e.g. \'woman ~25, long straight black hair, oval face, no glasses\'. NEVER a name."], ' +
  '"question": "one short question to ask the owner if something important is unclear (who someone is, where, when) — else null"}';

export function visionModel(): string {
  return env.VISION_MODEL;
}

export async function describeImage(base64DataUri: string): Promise<VisionResult> {
  const res = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY || "ollama"}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: base64DataUri } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    }),
  });
  if (!res.ok) throw new Error(`vision ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";

  // Evict the 7B vision model from memory immediately. On a 16GB Mac the vision and text models
  // can't both stay resident — leaving it loaded starves the text model (the cause of the
  // 16-minute persona hang). Best-effort and local-only; never blocks or fails the describe.
  if (isLocalLLM()) await unloadModel(env.VISION_MODEL).catch(() => {});

  const obj = looseJson(text);

  const caption = str(obj?.caption).slice(0, 100) || "A photo";
  return {
    caption,
    description: str(obj?.description) || caption,
    people: Array.isArray(obj?.people) ? obj!.people.map(str).filter(Boolean).slice(0, 10) : [],
    faces: Array.isArray(obj?.faces) ? obj!.faces.map(str).filter(Boolean).slice(0, 10) : [],
    question: obj?.question && str(obj.question).trim() ? str(obj.question).trim() : null,
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Tell Ollama to drop a model from memory now (keep_alive: 0), via its native API. */
async function unloadModel(model: string): Promise<void> {
  const base = env.OPENROUTER_BASE_URL.replace(/\/v1\/?$/, "");
  await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, keep_alive: 0 }),
  });
}

/** Pull the first JSON object out of a possibly-noisy vision response. */
function looseJson(raw: string): Record<string, any> | null {
  let s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
