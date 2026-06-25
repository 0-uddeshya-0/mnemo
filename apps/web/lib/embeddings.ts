/**
 * Embeddings — the one place vectors are produced. Documented interface:
 *   embed(texts: string[]): Promise<number[][]>
 *
 * Runs `all-MiniLM-L6-v2` (384-dim) fully in-process via transformers.js (ONNX) — free,
 * offline, and the same model can later run in-browser for on-device search. The model is
 * downloaded once (then cached); after that, no network is needed. Every vector row stores
 * `embed_provider` so a future model swap + re-embed is unambiguous.
 */
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBED_DIM } from "@/lib/graph/constants";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBED_PROVIDER = "all-MiniLM-L6-v2";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

/** Provider string tagged onto every vector row. */
export function activeEmbedProvider(): string {
  return EMBED_PROVIDER;
}

/** Embed a batch of texts → one 384-dim, L2-normalized vector each, in input order. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  // Empty strings break pooling; replace with a single space.
  const cleaned = texts.map((t) => (t && t.trim().length > 0 ? t : " "));
  const extractor = await getExtractor();
  const output = await extractor(cleaned, { pooling: "mean", normalize: true });
  const vectors = output.tolist() as number[][];
  if (vectors.length !== cleaned.length || (vectors[0] && vectors[0].length !== EMBED_DIM)) {
    throw new Error(
      `Embedder returned malformed output (expected ${cleaned.length}×${EMBED_DIM}, got ${vectors.length}×${vectors[0]?.length ?? 0}).`,
    );
  }
  return vectors;
}
