"use server";
import { assertOwner } from "@/lib/auth/guard";
import { getBoss, QUEUES } from "@/lib/queue";
import { executeProposals, runAgent, type AgentResult, type ProposedAction } from "@/lib/agent/runtime";
import { buildPersona } from "@/lib/agent/persona";
import { listPendingRuns, resolveRun, type RunRecord } from "@/lib/agent/runs";

export async function runAgentAction(
  task: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<AgentResult> {
  await assertOwner();
  try {
    return await runAgent(task, history);
  } catch (e) {
    // Never surface a raw 500 to the chat. On the local model a heavy task can still time out;
    // answer in MNEMO's own voice so the conversation continues instead of breaking.
    const msg = (e as Error).message || "";
    const slow = /aborted|timeout|All LLM models failed/i.test(msg);
    console.error("[agent] run failed:", msg);
    return {
      answer: slow
        ? "That one took longer than I could hold my breath for — the on-device model gets slow on big multi-step asks, especially just after a restart. I'm kept warm now, so give it another go in a few seconds, or narrow it down a touch and I'll be quicker."
        : "Something tripped me up mid-thought there. Mind trying again, or rephrasing it slightly?",
      steps: [],
      proposals: [],
    };
  }
}

/** Kick off a slow deep-research pass in the background; the brief lands in the inbox. */
export async function startDeepResearchAction(topic: string): Promise<{ ok: boolean; error?: string }> {
  await assertOwner();
  const t = topic.trim();
  if (t.length < 3) return { ok: false, error: "Give me a topic to research." };
  const boss = await getBoss();
  await boss.send(QUEUES.research, { topic: t.slice(0, 300) });
  return { ok: true };
}

export async function executeProposalsAction(
  proposals: ProposedAction[],
  runId?: string,
): Promise<{ executed: number }> {
  await assertOwner();
  return executeProposals(proposals, runId);
}

export async function rebuildPersonaAction(): Promise<{ persona: string }> {
  await assertOwner();
  return { persona: await buildPersona() };
}

/** The daily-digest inbox: runs MNEMO left for the owner to review. */
export async function listInboxAction(): Promise<RunRecord[]> {
  await assertOwner();
  return listPendingRuns();
}

export async function dismissRunAction(runId: string): Promise<{ ok: true }> {
  await assertOwner();
  await resolveRun(runId, "dismissed");
  return { ok: true };
}

export type { AgentResult, ProposedAction, RunRecord };
