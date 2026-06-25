/**
 * Zod-validated environment. Parsing is lenient (defaults everywhere) so `next build`
 * never crashes on a missing secret; the *consumers* (embeddings, llm, auth, crypto)
 * enforce that the value they actually need is present at call time. Server-only —
 * never import this from a client component.
 */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://mnemosyne:mnemosyne@localhost:5432/mnemosyne"),

  MNEMOSYNE_PASSWORD: z.string().default(""),
  SESSION_SECRET: z.string().default(""),

  // Embeddings run locally (all-MiniLM via transformers.js) — no key needed.

  // LLM via OpenRouter (OpenAI-compatible). LLM_MODEL is a comma-separated FALLBACK CHAIN
  // (primary first): if one model is rate-limited/down, the next is tried automatically.
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z
    .string()
    .default(
      "nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3-nano-30b-a3b:free,google/gemma-4-31b-it:free",
    ),
  // Optional separate chain for deep synthesis; falls back to LLM_MODEL when empty.
  LLM_MODEL_DEEP: z.string().default(""),
  // Local vision model (Ollama) for understanding uploaded photos.
  VISION_MODEL: z.string().default("qwen2.5vl:7b"),

  // Local speech-to-text (whisper.cpp) — voice input stays on-device, never sent to the cloud.
  WHISPER_BIN: z.string().default("/opt/homebrew/bin/whisper-cli"),
  WHISPER_MODEL: z.string().default(""), // empty → resolved relative to repo (models/whisper)
  FFMPEG_BIN: z.string().default("/opt/homebrew/bin/ffmpeg"),

  APP_URL: z.string().default("http://localhost:3000"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(8848),

  // ── Connectors (MNEMO's senses + hands). All optional; a connector's tools only
  // appear once its credentials are present. See `pnpm connect:google` for OAuth setup.
  NOTION_TOKEN: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().default(""),
  GITHUB_TOKEN: z.string().default(""),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;

/** Throw a clear error if a required secret is absent at the point of use. */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === "" || value === undefined || value === null) {
    throw new Error(
      `Missing required environment variable ${String(key)}. Set it in your .env file.`,
    );
  }
  return value as NonNullable<Env[K]>;
}

/**
 * True when the active LLM endpoint lives on this machine (Ollama/local). When inference is
 * local, nothing ever leaves the Mac — so MNEMO may safely read and reason over private
 * content. The moment the endpoint points at a cloud API, private stays walled off unless
 * the owner has explicitly opted in. This is the single source of truth for that distinction.
 */
export function isLocalLLM(baseUrl: string = env.OPENROUTER_BASE_URL): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(host);
  } catch {
    return false;
  }
}
