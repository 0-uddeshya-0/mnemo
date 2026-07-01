/**
 * pg-boss singleton (Postgres-backed job queue; no Redis). The Next app enqueues jobs;
 * the standalone worker (scripts/worker.ts) processes them. Both call getBoss().
 */
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

export const QUEUES = {
  ingest: "ingest",
  synthesis: "synthesis",
  agent: "agent",
  archiveImport: "archive_import",
  vision: "vision",
  automations: "automations",
  research: "research",
} as const;

let bossPromise: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
      boss.on("error", (err) => console.error("[pg-boss]", err));
      await boss.start();
      // Queues must exist before send/work in pg-boss v10+.
      await boss.createQueue(QUEUES.ingest);
      await boss.createQueue(QUEUES.synthesis);
      await boss.createQueue(QUEUES.agent);
      await boss.createQueue(QUEUES.archiveImport);
      await boss.createQueue(QUEUES.vision);
      await boss.createQueue(QUEUES.automations);
      await boss.createQueue(QUEUES.research);
      return boss;
    })();
  }
  return bossPromise;
}

export interface IngestJobPayload {
  ingestJobId: string;
}

export interface SynthesisJobPayload {
  trigger: "manual" | "nightly";
}

export interface AgentJobPayload {
  job: "daily_digest";
  trigger: "manual" | "scheduled";
}

export interface ArchiveImportPayload {
  filePath: string; // a temp file holding the raw export
  filename: string;
  source: string; // human label, e.g. "WhatsApp chat", "X archive"
}

export interface VisionJobPayload {
  photoName: string; // stored filename in data/photos
  userNote?: string;
}

export interface ResearchJobPayload {
  topic: string;
}
