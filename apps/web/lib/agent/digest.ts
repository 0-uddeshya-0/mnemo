/**
 * MNEMO's daily digest — the proactive companion. Once a day it wakes on its own, reviews
 * what's new in the brain, looks for meaningful connections, and notices anything that
 * updates who the owner is. It NEVER writes on its own: per "read freely, ask before
 * acting," every change is left as a proposal in the inbox for the owner to approve.
 */
import { runAgent } from "@/lib/agent/runtime";
import { agentRecentActivity } from "@/lib/agent/api";
import { getDevSettings } from "@/lib/settings";

const DIGEST_TASK = [
  "It's your daily pass over my mind. I'm not here — this is your own initiative.",
  "Review what's new over the last day, find the few connections that genuinely matter,",
  "and notice anything that should update who I am. Propose a small number of high-value",
  "link_nodes (and add_knowledge only if clearly worth keeping). Then leave me a short, warm",
  "note in my voice about what you found. If nothing meaningful is new, propose nothing and say so.",
].join(" ");

export interface DigestResult {
  ran: boolean;
  runId?: string;
  proposals: number;
  reason?: string;
}

export async function runDailyDigest(): Promise<DigestResult> {
  const dev = await getDevSettings();
  if (!dev.digestEnabled) {
    return { ran: false, proposals: 0, reason: "daily digest is turned off in settings" };
  }
  // Cheap pre-check: don't burn the free LLM quota when nothing changed in the last day.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await agentRecentActivity(since, 5);
  const meaningful = recent.filter(
    (r) => r.action !== "agent_digest" && r.action !== "agent_run",
  );
  if (meaningful.length === 0) {
    return { ran: false, proposals: 0, reason: "nothing new in the last 24h" };
  }

  const task = dev.proactiveQuestions ? DIGEST_TASK : `${DIGEST_TASK} (Don't ask me any questions this time — just the note and proposals.)`;
  const result = await runAgent(task, [], { mode: "digest", source: "scheduler" });
  return { ran: true, runId: result.runId, proposals: result.proposals.length };
}
