/**
 * Mnemosyne background worker. Processes ingest jobs (and, later, synthesis jobs) off the
 * pg-boss queue. Run alongside the web app:  pnpm worker
 */
import "@/lib/server/load-env";
import { readFile, unlink } from "node:fs/promises";
import {
  getBoss,
  QUEUES,
  type AgentJobPayload,
  type ArchiveImportPayload,
  type IngestJobPayload,
  type SynthesisJobPayload,
  type VisionJobPayload,
} from "@/lib/queue";
import { runIngestJob } from "@/lib/pipeline/run";
import { runSynthesis } from "@/lib/synthesis/run";
import { runDailyDigest } from "@/lib/agent/digest";
import { parseArchive } from "@/lib/import/parse";
import { runArchiveImport } from "@/lib/import/run";
import { runPhotoIngest } from "@/lib/vision-ingest";
import { checkEncryptionKey } from "@/lib/crypto";

async function main() {
  const boss = await getBoss();

  // Surface a changed encryption password loudly (it would otherwise silently orphan all
  // existing private content). Non-fatal — new private data still encrypts under the new key.
  try {
    const keyState = await checkEncryptionKey();
    if (keyState === "changed") {
      console.error(
        "⚠️  ENCRYPTION KEY MISMATCH — MNEMOSYNE_PASSWORD changed; existing PRIVATE bodies can no longer be decrypted. " +
          "Restore the original password, or recover with: pnpm mnemo restore <backup-dir>",
      );
    }
  } catch (err) {
    console.warn("[worker] encryption-key check skipped:", (err as Error).message);
  }

  await boss.work<IngestJobPayload>(QUEUES.ingest, async (jobs) => {
    for (const job of jobs) {
      const { ingestJobId } = job.data;
      console.log(`[worker] ingest job ${ingestJobId} …`);
      try {
        const result = await runIngestJob(ingestJobId);
        console.log(
          `[worker] ingest ${ingestJobId} done — ${result.createdNodeIds.length} nodes, ${result.edgeCount} edges${result.duplicate ? " (duplicate, no-op)" : ""}`,
        );
      } catch (err) {
        console.error(`[worker] ingest ${ingestJobId} FAILED:`, (err as Error).message);
      }
    }
  });

  await boss.work<SynthesisJobPayload>(QUEUES.synthesis, async (jobs) => {
    for (const job of jobs) {
      console.log(`[worker] synthesis (${job.data.trigger}) …`);
      try {
        const summary = await runSynthesis(job.data.trigger);
        console.log(`[worker] synthesis done —`, summary);
      } catch (err) {
        console.error(`[worker] synthesis FAILED:`, (err as Error).message);
      }
    }
  });

  // Archive import: distill an exported file (WhatsApp / X / Claude / Keep / journal) into
  // dated nodes — the heavy LLM work runs here, off the request path.
  await boss.work<ArchiveImportPayload>(QUEUES.archiveImport, async (jobs) => {
    for (const job of jobs) {
      const { filePath, filename, source } = job.data;
      console.log(`[worker] archive import "${filename}" (${source}) …`);
      try {
        const content = await readFile(filePath, "utf8");
        const parsed = parseArchive(filename, content);
        const result = await runArchiveImport(parsed, source);
        console.log(`[worker] import done — ${result.created} nodes from ${result.total} items (${parsed.kind})`);
      } catch (err) {
        console.error(`[worker] archive import FAILED:`, (err as Error).message);
      } finally {
        await unlink(filePath).catch(() => {});
      }
    }
  });

  // Vision: MNEMO looks at an uploaded photo and turns it into a memory (local model).
  await boss.work<VisionJobPayload>(QUEUES.vision, async (jobs) => {
    for (const job of jobs) {
      console.log(`[worker] vision: looking at ${job.data.photoName} …`);
      try {
        const r = await runPhotoIngest(job.data.photoName, job.data.userNote);
        console.log(`[worker] vision done — "${r.caption}"${r.question ? ` (asks: ${r.question})` : ""}`);
      } catch (err) {
        console.error(`[worker] vision FAILED:`, (err as Error).message);
      }
    }
  });

  // MNEMO's proactive daily digest: review what's new, propose links/persona updates.
  // Acts only by PROPOSING — the owner approves from the inbox (read freely, ask before acting).
  await boss.work<AgentJobPayload>(QUEUES.agent, async (jobs) => {
    for (const job of jobs) {
      console.log(`[worker] agent ${job.data.job} (${job.data.trigger}) …`);
      try {
        const result = await runDailyDigest();
        console.log(
          result.ran
            ? `[worker] daily digest done — ${result.proposals} proposal(s) queued for review`
            : `[worker] daily digest skipped — ${result.reason}`,
        );
      } catch (err) {
        console.error(`[worker] agent job FAILED:`, (err as Error).message);
      }
    }
  });

  // Nightly synthesis at 03:00 (clustering, contradictions, gaps, dormant).
  try {
    await boss.schedule(QUEUES.synthesis, "0 3 * * *", { trigger: "nightly" });
  } catch (err) {
    console.warn("[worker] could not register nightly synthesis schedule:", (err as Error).message);
  }

  // Daily digest at 08:00 (after nightly synthesis, so it sees fresh clusters/insights).
  try {
    await boss.schedule(QUEUES.agent, "0 8 * * *", { job: "daily_digest", trigger: "scheduled" });
  } catch (err) {
    console.warn("[worker] could not register daily digest schedule:", (err as Error).message);
  }

  console.log(`✓ Mnemosyne worker running. Queues: ${Object.values(QUEUES).join(", ")}`);
}

main().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});
