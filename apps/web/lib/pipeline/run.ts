/**
 * Pipeline orchestrator — runs Stages 1–6 for one ingest job, idempotently, updating the
 * ingest_jobs row's stage/status so the capture UI can show live progress.
 *
 *   acquire → chunk → embed → extract → link → reconcile
 *
 * Idempotency: a content-hash guard at Stage 1 makes re-ingesting identical content a
 * no-op; atom dedupe (cosine ≥ 0.92 / title) and edge upserts make re-runs converge.
 */
import { createHash } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chunks as chunksTable, ingestJobs, nodes } from "@/lib/db/schema";
import { embed } from "@/lib/embeddings";
import { acquire } from "@/lib/pipeline/parse";
import { chunkText } from "@/lib/pipeline/chunk";
import { extractAtoms } from "@/lib/pipeline/extract";
import { adjudicateLinks } from "@/lib/pipeline/link";
import {
  createNode,
  mergeOrInsertAtom,
  reconcileSalience,
  upsertEdge,
  type AtomInput,
} from "@/lib/graph/store";
import { ensureSelf } from "@/lib/graph/self";
import { getAgentExposure } from "@/lib/settings";
import type { AcquiredSource, PipelineStage, RawIngestInput } from "@/lib/pipeline/types";
import type { EdgeType, JobStatus, NodeType } from "@/lib/graph/constants";

export interface RunResult {
  sourceId: string | null;
  createdNodeIds: string[];
  edgeCount: number;
  duplicate: boolean;
}

const SOURCE_EMBED_BODY_CHARS = 4000;
const MAX_LINK_ADJUDICATIONS = 24;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function setStage(jobId: string, stage: PipelineStage | null, status: JobStatus) {
  await db.update(ingestJobs).set({ stage, status }).where(eq(ingestJobs.id, jobId));
}

async function finish(jobId: string, result: Record<string, unknown>) {
  await db
    .update(ingestJobs)
    .set({ status: "done", stage: null, result })
    .where(eq(ingestJobs.id, jobId));
}

export async function runIngestJob(jobId: string): Promise<RunResult> {
  const [job] = await db.select().from(ingestJobs).where(eq(ingestJobs.id, jobId)).limit(1);
  if (!job) throw new Error(`ingest job ${jobId} not found`);
  const input = job.payload as unknown as RawIngestInput;

  try {
    // ── Stage 1: Acquire ────────────────────────────────────────────────────
    await setStage(jobId, "acquire", "running");
    const source = await acquire(input);
    const hash = sha256(`${source.title}::${source.markdown}`);

    const [dupe] = await db
      .select({ id: nodes.id })
      .from(nodes)
      .where(sql`properties->>'hash' = ${hash}`)
      .limit(1);
    if (dupe) {
      await finish(jobId, { duplicate: true, sourceId: dupe.id, createdNodes: 0 });
      return { sourceId: dupe.id, createdNodeIds: [], edgeCount: 0, duplicate: true };
    }

    const selfId = await ensureSelf();

    // ── Stage 2: Chunk ──────────────────────────────────────────────────────
    await setStage(jobId, "chunk", "running");
    const chunkList = chunkText(source.markdown);

    // ── Stage 3: Embed (source + chunks) ────────────────────────────────────
    await setStage(jobId, "embed", "running");
    const sourceEmbedText = `${source.title}\n${source.markdown.slice(0, SOURCE_EMBED_BODY_CHARS)}`;
    const [sourceVec] = await embed([sourceEmbedText]);

    const sourceId = await createNode(
      {
        type: source.nodeType,
        title: source.title,
        body: source.markdown,
        properties: { ...source.properties, hash },
        confidence: 1,
        sensitivity: source.sensitivity,
        embedding: sourceVec ?? null,
      },
      "owner",
    );

    if (chunkList.length > 0) {
      const chunkVecs = await embed(chunkList);
      await db.insert(chunksTable).values(
        chunkList.map((text, i) => ({
          nodeId: sourceId,
          ordinal: i,
          text,
          embedding: chunkVecs[i] ?? null,
        })),
      );
    }

    const createdNodeIds: string[] = [sourceId];
    let edgeCount = 0;

    // source → self (learned_from); author provenance
    await upsertEdge({ src: sourceId, dst: selfId, type: "learned_from", weight: 0.9, rationale: "Consumed/created by the owner." });
    edgeCount++;

    if (typeof source.properties.author === "string" && source.properties.author.trim()) {
      const author = await mergeOrInsertAtom(
        { type: "person", title: source.properties.author.trim(), confidence: 0.8 },
        "llm",
      );
      await upsertEdge({ src: sourceId, dst: author.id, type: "authored_by", weight: 0.9, rationale: "Listed author of the source." });
      createdNodeIds.push(author.id);
      edgeCount++;
    }

    // Connector pre-quotes (e.g. Readwise highlights) — deterministic, and they persist
    // even if the LLM extraction is unavailable below.
    if (input.kind === "connector" && input.quotes?.length) {
      const qTexts = input.quotes.map((q) => q.text);
      const qVecs = await embed(qTexts);
      for (let i = 0; i < input.quotes.length; i++) {
        const q = input.quotes[i]!;
        const { id } = await mergeOrInsertAtom(
          {
            type: "quote",
            title: q.text.slice(0, 80),
            body: q.text,
            summary: q.text.slice(0, 200),
            properties: { why_notable: q.why_notable },
            confidence: 0.9,
            sourceId,
            embedding: qVecs[i],
          },
          "owner",
        );
        createdNodeIds.push(id);
        await upsertEdge({ src: id, dst: sourceId, type: "learned_from", weight: 0.8, rationale: `Highlight from “${source.title}”.` });
        edgeCount++;
      }
    }

    // ── Stages 4–5: Extract + Link (the only stages that use the LLM) ──
    // Private content is stored + embedded locally regardless. It's also *extracted* into
    // structured knowledge when inference is local (it never leaves the Mac) or the owner has
    // opted into cloud; otherwise extraction is skipped so private text never reaches a cloud
    // LLM. An LLM outage is non-fatal — the source/chunks/quotes above already persist.
    const { exposePrivate } = await getAgentExposure();
    let adjudicated = 0;
    let extractionError: string | null = null;
    if (source.sensitivity === "private" && !exposePrivate) {
      extractionError = "skipped: private content is not sent to a cloud LLM";
    } else {
      try {
        const linked = await extractAndLink({ jobId, source, sourceId, selfId, chunkList });
        createdNodeIds.push(...linked.createdNodeIds);
        edgeCount += linked.edgesAdded;
        adjudicated = linked.adjudicated;
      } catch (err) {
        extractionError = (err as Error).message;
        console.error("[pipeline] extraction/linking failed (non-fatal):", extractionError);
      }
    }

    // ── Stage 6: Reconcile salience ─────────────────────────────────────────
    await setStage(jobId, "reconcile", "running");
    for (const id of new Set(createdNodeIds)) {
      await reconcileSalience(id);
    }

    // What MNEMO actually learned from this — the real atoms, most salient first — so the owner
    // can SEE what changed in their brain after a capture, not just a count.
    const ids = [...new Set(createdNodeIds)];
    const learned = ids.length
      ? await db
          .select({ title: nodes.title, type: nodes.type })
          .from(nodes)
          .where(inArray(nodes.id, ids))
          .orderBy(desc(nodes.salience))
          .limit(12)
      : [];

    await finish(jobId, {
      duplicate: false,
      sourceId,
      createdNodes: ids.length,
      edges: edgeCount,
      adjudicated,
      extractionError,
      learned,
    });

    return { sourceId, createdNodeIds: [...new Set(createdNodeIds)], edgeCount, duplicate: false };
  } catch (err) {
    await db
      .update(ingestJobs)
      .set({ status: "error", error: (err as Error).message })
      .where(eq(ingestJobs.id, jobId));
    throw err;
  }
}

/**
 * Stages 4 (extract atoms) + 5 (link). Returns the nodes/edges it created so the
 * orchestrator can fold them into the job's running totals.
 */
async function extractAndLink(args: {
  jobId: string;
  source: AcquiredSource;
  sourceId: string;
  selfId: string;
  chunkList: string[];
}): Promise<{ createdNodeIds: string[]; edgesAdded: number; adjudicated: number }> {
  const { jobId, source, sourceId, selfId, chunkList } = args;
  const createdNodeIds: string[] = [];
  let edgesAdded = 0;

  // ── Stage 4: Extract atoms ──────────────────────────────────────────────
  await setStage(jobId, "extract", "running");
  const extraction = await extractAtoms({
    title: source.title,
    chunks: chunkList.length ? chunkList : [source.markdown],
    ownerAuthored: source.ownerAuthored,
  });
  if (extraction.summary) {
    await db.update(nodes).set({ summary: extraction.summary }).where(eq(nodes.id, sourceId));
  }

  // Plan one node per atom, with the text we'll embed for it.
  type Plan = { node: AtomInput; text: string; provenance: "learned_from" | "mentions"; conceptual: boolean };
  const mk = (
    type: NodeType,
    title: string,
    body: string,
    confidence: number,
    props: Record<string, unknown>,
    provenance: "learned_from" | "mentions",
    conceptual: boolean,
  ): Plan => ({
    node: { type, title, body: body || null, summary: body ? body.slice(0, 200) : null, properties: props, confidence, sourceId },
    text: `${title}. ${body}`,
    provenance,
    conceptual,
  });

  const plans: Plan[] = [
    ...extraction.concepts.map((c) => mk("concept", c.title, c.definition, 0.7, {}, "learned_from", true)),
    ...extraction.skills.map((s) => mk("skill", s.title, s.note, 0.7, {}, "learned_from", true)),
    ...extraction.people.map((p) => mk("person", p.name, "", 0.7, { role: p.role }, "mentions", false)),
    ...extraction.orgs.map((o) => mk("org", o, "", 0.7, {}, "mentions", false)),
    ...extraction.places.map((pl) => mk("place", pl, "", 0.7, {}, "mentions", false)),
    ...extraction.quotes.map((q) => mk("quote", q.text.slice(0, 80), q.text, 0.8, { why_notable: q.why_notable }, "learned_from", false)),
    ...extraction.open_questions.map((q) => mk("question", q, "", 0.6, {}, "learned_from", true)),
  ];

  // Owner signals (only present when ownerAuthored): confidence 1.0, wired to self.
  const ownerEdge: Partial<Record<NodeType, EdgeType>> = {
    belief: "believes",
    interest: "interested_in",
    goal: "aspires_to",
    trait: "relates_to",
  };
  const ownerPlans: { node: AtomInput; text: string; selfType: NodeType }[] = [];
  const pushOwner = (type: NodeType, title: string) =>
    ownerPlans.push({ node: { type, title, confidence: 1, sourceId }, text: title, selfType: type });
  extraction.owner_signals.beliefs.forEach((b) => pushOwner("belief", b));
  extraction.owner_signals.interests.forEach((i) => pushOwner("interest", i));
  extraction.owner_signals.traits.forEach((t) => pushOwner("trait", t));
  extraction.owner_signals.goals.forEach((g) => pushOwner("goal", g));

  // Embed every atom in one batch.
  const allTexts = [...plans.map((p) => p.text), ...ownerPlans.map((p) => p.text)];
  const allVecs = allTexts.length ? await embed(allTexts) : [];
  let vi = 0;

  const conceptualIds: string[] = [];

  for (const plan of plans) {
    const { id } = await mergeOrInsertAtom({ ...plan.node, embedding: allVecs[vi++] ?? null }, "llm");
    createdNodeIds.push(id);
    await upsertEdge({ src: id, dst: sourceId, type: plan.provenance, weight: 0.8, confidence: 0.8, rationale: `From “${source.title}”.` });
    edgesAdded++;
    if (plan.conceptual) conceptualIds.push(id);
  }

  for (const plan of ownerPlans) {
    const { id } = await mergeOrInsertAtom({ ...plan.node, embedding: allVecs[vi++] ?? null }, "owner");
    createdNodeIds.push(id);
    await upsertEdge({ src: selfId, dst: id, type: ownerEdge[plan.selfType] ?? "relates_to", weight: 0.9, confidence: 1, rationale: "Stated by the owner." });
    await upsertEdge({ src: id, dst: sourceId, type: "learned_from", weight: 0.7, confidence: 0.9, rationale: "Surfaced from the owner's own writing." });
    edgesAdded += 2;
    conceptualIds.push(id);
  }

  // ── Stage 5: Link (semantic adjudication + belief evolution) ────────────
  await setStage(jobId, "link", "running");
  let adjudicated = 0;
  for (const id of conceptualIds.slice(0, MAX_LINK_ADJUDICATIONS)) {
    try {
      edgesAdded += await adjudicateLinks(id);
      adjudicated++;
    } catch (err) {
      console.error(`[link] adjudication failed for ${id}:`, (err as Error).message);
    }
  }

  return { createdNodeIds, edgesAdded, adjudicated };
}
