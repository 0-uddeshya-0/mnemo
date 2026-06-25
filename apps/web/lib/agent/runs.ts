/**
 * Persistence for MNEMO's runs — its episodic memory and the daily-digest inbox.
 * Every invocation is recorded; runs that left proposals sit in 'pending_review' until
 * the owner approves or dismisses them, so MNEMO never silently acts and never forgets.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRuns } from "@/lib/db/schema";
import type { AgentRunMode, AgentRunStatus } from "@/lib/graph/constants";
import type { AgentStep, ProposedAction } from "@/lib/agent/runtime";

export interface RunRecord {
  id: string;
  mode: AgentRunMode;
  task: string;
  answer: string;
  steps: AgentStep[];
  proposals: ProposedAction[];
  status: AgentRunStatus;
  source: string;
  createdAt: string;
}

export async function recordRun(input: {
  mode: AgentRunMode;
  task: string;
  answer: string;
  steps: AgentStep[];
  proposals: ProposedAction[];
  source: string;
}): Promise<string> {
  const status: AgentRunStatus = input.proposals.length > 0 ? "pending_review" : "answered";
  const [row] = await db
    .insert(agentRuns)
    .values({
      mode: input.mode,
      task: input.task,
      answer: input.answer,
      steps: input.steps,
      proposals: input.proposals,
      status,
      source: input.source,
    })
    .returning({ id: agentRuns.id });
  return row!.id;
}

function toRecord(r: typeof agentRuns.$inferSelect): RunRecord {
  return {
    id: r.id,
    mode: r.mode,
    task: r.task,
    answer: r.answer,
    steps: (r.steps as AgentStep[]) ?? [],
    proposals: (r.proposals as ProposedAction[]) ?? [],
    status: r.status,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The inbox: runs (usually from the daily digest) that left proposals to review. */
export async function listPendingRuns(limit = 20): Promise<RunRecord[]> {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.status, "pending_review"))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
  return rows.map(toRecord);
}

export async function resolveRun(id: string, status: "reviewed" | "dismissed"): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status, reviewedAt: new Date() })
    .where(and(eq(agentRuns.id, id), eq(agentRuns.status, "pending_review")));
}
