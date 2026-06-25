import type { NodeType, Sensitivity } from "@/lib/graph/constants";

/** The normalized output of Stage 1 (Acquire). Everything downstream is uniform. */
export interface AcquiredSource {
  nodeType: NodeType; // book | article | paper | course | note | creative_work
  title: string;
  markdown: string;
  properties: Record<string, unknown>; // author, url, year, siteName, …
  ownerAuthored: boolean; // true → run owner_signals extraction (beliefs/interests/…)
  sensitivity?: Sensitivity;
}

/** A pre-extracted highlight/quote provided by a connector (e.g. Readwise). */
export interface PreQuote {
  text: string;
  why_notable?: string;
}

/** Raw inputs accepted by the pipeline. Stored as the ingest_jobs.payload. */
export type RawIngestInput =
  | {
      kind: "note";
      title?: string;
      body: string;
      nodeType?: NodeType;
      sensitivity?: Sensitivity;
      ownerAuthored?: boolean;
    }
  | { kind: "url"; url: string; note?: string }
  | { kind: "file"; path: string; filename: string; mime?: string }
  | { kind: "share"; title?: string; text?: string; url?: string }
  | {
      kind: "connector";
      provider: string;
      source: AcquiredSource;
      quotes?: PreQuote[];
    }
  | {
      kind: "interview_answer";
      phase: string;
      question: string;
      answer: string;
    };

export const PIPELINE_STAGES = [
  "acquire",
  "chunk",
  "embed",
  "extract",
  "link",
  "reconcile",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
