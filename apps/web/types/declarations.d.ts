// pdf-parse v1's index.js runs a debug file-read at import time under ESM (no
// module.parent), which crashes. Import the inner lib entrypoint instead — typed here.
declare module "pdf-parse/lib/pdf-parse.js" {
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<{ text: string; numpages: number; numrender: number; info?: Record<string, unknown>; metadata?: unknown }>;
  export default pdfParse;
}

declare module "graphology-communities-louvain" {
  import type Graph from "graphology";
  interface LouvainOptions {
    getEdgeWeight?: string | ((edge: string, attr: Record<string, unknown>) => number) | null;
    resolution?: number;
    rng?: () => number;
  }
  interface DetailedOutput {
    count: number;
    communities: Record<string, number>;
    modularity: number;
  }
  function louvain(graph: Graph, options?: LouvainOptions): Record<string, number>;
  namespace louvain {
    function detailed(graph: Graph, options?: LouvainOptions): DetailedOutput;
  }
  export default louvain;
}
