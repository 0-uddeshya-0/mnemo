/**
 * Public entry to the pipeline. Creates the ingest_jobs row and enqueues it on pg-boss.
 * The worker (scripts/worker.ts) picks it up and runs Stages 1–6.
 */
import { db } from "@/lib/db";
import { ingestJobs } from "@/lib/db/schema";
import { getBoss, QUEUES } from "@/lib/queue";
import type { RawIngestInput } from "@/lib/pipeline/types";

export async function enqueueIngest(input: RawIngestInput): Promise<{ ingestJobId: string }> {
  const [job] = await db
    .insert(ingestJobs)
    .values({ kind: input.kind, status: "queued", payload: input as Record<string, unknown> })
    .returning({ id: ingestJobs.id });
  if (!job) throw new Error("failed to create ingest job");

  const boss = await getBoss();
  await boss.send(QUEUES.ingest, { ingestJobId: job.id });
  return { ingestJobId: job.id };
}
