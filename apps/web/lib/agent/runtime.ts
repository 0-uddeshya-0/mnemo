/**
 * The MNEMO agent runtime — a production-style tool-use loop ("the harness"). Each step the
 * model reasons and emits a JSON action; READ tools execute and feed observations back;
 * WRITE/EXTERNAL tools become proposals the owner approves (read-freely, ask-before-acting).
 * Provider-agnostic via lib/llm (free OpenRouter chain now; one env line to local Ollama).
 */
import { z } from "zod";
import { completeJSON } from "@/lib/llm";
import { getPersona } from "@/lib/agent/persona";
import { buildSystemPrompt } from "@/lib/agent/constitution";
import { recordRun, resolveRun } from "@/lib/agent/runs";
import { getAgentTools, findTool, type ToolTier } from "@/lib/agent/tools";
import { recordActivity } from "@/lib/graph/store";
import type { AgentRunMode } from "@/lib/graph/constants";

export interface AgentStep {
  thought: string;
  tool?: string;
  args?: Record<string, unknown>;
  observation?: string;
}

export interface ProposedAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  tier: ToolTier;
  summary: string;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  proposals: ProposedAction[];
  /** Id of the persisted run (so the UI can resolve its proposals later). */
  runId?: string;
}

export interface RunOptions {
  /** "chat" (interactive) or "digest" (autonomous proactive pass). */
  mode?: AgentRunMode;
  /** Where the task came from: owner | siri | scheduler. */
  source?: string;
  /** Persist to agent_runs (episodic memory + inbox). Default true. */
  persist?: boolean;
}

const StepSchema = z.object({
  thought: z.string().default(""),
  tool: z.string().nullable().default(null),
  args: z.record(z.unknown()).default({}),
  final: z.string().nullable().default(null),
});

const MAX_ITERS = 8;
const OBS_LIMIT = 2200;

export async function runAgent(
  task: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  opts: RunOptions = {},
): Promise<AgentResult> {
  const mode: AgentRunMode = opts.mode ?? "chat";
  const source = opts.source ?? "owner";
  const persist = opts.persist ?? true;
  const tools = await getAgentTools();
  const system = buildSystemPrompt({ persona: await getPersona(), mode, tools });
  const steps: AgentStep[] = [];
  const proposals: ProposedAction[] = [];
  const scratch: string[] = [];
  let gatheredEvidence = false; // did any read tool actually return evidence to ground against?
  if (history.length) {
    scratch.push("CONVERSATION:\n" + history.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n"));
  }
  scratch.push(`TASK: ${task}`);

  async function finalize(answer: string): Promise<AgentResult> {
    await recordActivity({
      action: mode === "digest" ? "agent_digest" : "agent_run",
      actor: source === "owner" ? "owner" : "agent",
      detail: { task, mode, source, steps: steps.length, proposals: proposals.length },
    });
    let runId: string | undefined;
    if (persist) {
      runId = await recordRun({ mode, task, answer, steps, proposals, source });
    }
    return { answer, steps, proposals, runId };
  }

  // Reflection pass: before committing, re-check the draft against the evidence actually
  // gathered — keep only what's supported, label inferences, surface uncertainty/conflicts.
  // This is what makes a small local model answer clearly instead of overreaching. Runs on the
  // `deep` slot (a bigger model when configured), once per answer, only when there's evidence.
  async function verify(draft: string): Promise<string> {
    if (!gatheredEvidence) return draft; // pure conversational reply — nothing to ground against
    try {
      const checked = await completeJSON({
        schema: z.object({ final: z.string() }),
        system,
        model: "deep",
        maxTokens: 800,
        temperature: 0.2,
        timeoutMs: 240_000,
        prompt:
          `${scratch.join("\n\n")}\n\nDRAFT ANSWER:\n${draft}\n\n` +
          'Produce your FINAL answer as {"final": string}. Verify it against the evidence above: ' +
          "keep only what's supported by what you found or what they've asserted; label inferences as inferences " +
          "('you seem to…'); if something is uncertain or missing, say so plainly instead of guessing; if the " +
          "evidence conflicts, surface both sides. Their voice, concise, no preamble.",
      });
      return checked.final?.trim() || draft;
    } catch {
      return draft; // verification is best-effort — never drop a good answer over it
    }
  }

  for (let i = 0; i < MAX_ITERS; i++) {
    const step = await completeJSON({
      schema: StepSchema,
      system,
      prompt: `${scratch.join("\n\n")}\n\nYour next step (JSON only):`,
      model: "fast",
      maxTokens: 900,
      temperature: 0.4,
      timeoutMs: 240_000, // local 7B multi-step reasoning is slow; don't abort a working step
    });

    if (step.final) {
      if (step.thought) steps.push({ thought: step.thought });
      return finalize(await verify(step.final));
    }
    if (!step.tool) {
      scratch.push("(no tool and no final given — finalize your answer now.)");
      continue;
    }

    const tool = findTool(tools, step.tool);
    if (!tool) {
      steps.push({ thought: step.thought, tool: step.tool, observation: "unknown tool" });
      scratch.push(`STEP ${i + 1}: unknown tool "${step.tool}". Available: ${tools.map((t) => t.name).join(", ")}.`);
      continue;
    }

    if (tool.tier === "read") {
      let obs: string;
      try {
        obs = (await tool.run(step.args)).slice(0, OBS_LIMIT);
        gatheredEvidence = true;
      } catch (e) {
        obs = `error: ${(e as Error).message}`;
      }
      steps.push({ thought: step.thought, tool: tool.name, args: step.args, observation: obs });
      scratch.push(`STEP ${i + 1}: ${tool.name}(${JSON.stringify(step.args)}) →\n${obs}`);
    } else {
      const id = Math.random().toString(36).slice(2, 10);
      const summary = `${tool.name}(${JSON.stringify(step.args)})`;
      proposals.push({ id, tool: tool.name, args: step.args, tier: tool.tier, summary });
      steps.push({ thought: step.thought, tool: tool.name, args: step.args, observation: "PROPOSED — awaiting your approval" });
      scratch.push(`STEP ${i + 1}: proposed ${summary} (queued for the owner's approval; assume it will happen and continue planning).`);
    }
  }

  const wrap = await completeJSON({
    schema: z.object({ final: z.string() }),
    system,
    prompt: `${scratch.join("\n\n")}\n\nYou've taken enough steps. Give your final answer now as {"final": string}.`,
    model: "fast",
    maxTokens: 700,
    timeoutMs: 240_000,
  });
  return finalize(await verify(wrap.final));
}

/**
 * Execute the proposals the owner approved (write/external tools), logged as owner-approved.
 * If `runId` is given, the run is resolved (so it leaves the daily-digest inbox).
 */
export async function executeProposals(
  proposals: ProposedAction[],
  runId?: string,
): Promise<{ executed: number }> {
  const tools = await getAgentTools();
  let executed = 0;
  for (const p of proposals) {
    const tool = findTool(tools, p.tool);
    if (!tool || tool.tier === "read") continue;
    try {
      await tool.run(p.args);
      await recordActivity({ action: "agent_action_approved", actor: "owner", detail: { tool: p.tool, args: p.args } });
      executed++;
    } catch (e) {
      console.error("[agent] proposal failed:", (e as Error).message);
    }
  }
  if (runId) await resolveRun(runId, "reviewed");
  return { executed };
}
