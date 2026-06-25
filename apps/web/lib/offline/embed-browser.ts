"use client";
/**
 * In-browser MiniLM embedder for offline semantic search. Runs `all-MiniLM-L6-v2` (the SAME
 * model the server uses) via transformers.js + ONNX-WASM. The model is fetched once and
 * cached by the browser, so after one warm it works with zero network.
 *
 * Only ever dynamic-import()ed (never statically) so transformers.js (large) stays out of
 * the main bundle and loads on demand.
 */
import { EMBED_DIM } from "@/lib/graph/constants";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

interface Tensor {
  tolist(): number[][];
}
type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<Tensor>;

let pipePromise: Promise<Extractor> | null = null;
let ready = false;

export function browserEmbedderReady(): boolean {
  return ready;
}

/** Load (and cache) the model. Resolves once it's ready for offline use. */
export async function warmBrowserEmbedder(
  onProgress?: (fraction: number) => void,
): Promise<void> {
  await getPipe(onProgress);
}

async function getPipe(onProgress?: (fraction: number) => void): Promise<Extractor> {
  if (!pipePromise) {
    pipePromise = (async () => {
      const tf = (await import("@huggingface/transformers")) as unknown as {
        env: { allowLocalModels: boolean };
        pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<Extractor>;
      };
      tf.env.allowLocalModels = false; // fetch from the hub, cache in the browser
      const pipe = await tf.pipeline("feature-extraction", MODEL_ID, {
        progress_callback: (e: { status?: string; progress?: number }) => {
          if (onProgress && typeof e.progress === "number") onProgress(e.progress / 100);
        },
      });
      ready = true;
      return pipe;
    })();
  }
  return pipePromise;
}

/** Embed a query string in the browser → 384-dim L2-normalized vector. */
export async function embedQueryInBrowser(text: string): Promise<number[]> {
  const pipe = await getPipe();
  const out = await pipe([text.trim() || " "], { pooling: "mean", normalize: true });
  const vec = out.tolist()[0];
  if (!vec || vec.length !== EMBED_DIM) {
    throw new Error(`browser embedding malformed (got ${vec?.length ?? 0}, want ${EMBED_DIM})`);
  }
  return vec;
}
