/**
 * Automations — owner-defined recurring agent tasks ("every morning, research X and relate it
 * to me"). A worker tick (~every 15 min) runs the ones that are due and drops the result into
 * the digest inbox for review. Learned from Khoj + OpenJarvis. Uses friendly presets
 * (daily / weekdays / weekly + time) instead of raw cron.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automations, agentRuns } from "@/lib/db/schema";
import { runAgent } from "@/lib/agent/runtime";

export type Frequency = "daily" | "weekdays" | "weekly";

export interface Automation {
  id: string;
  name: string;
  prompt: string;
  frequency: Frequency;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun .. 6=Sat (weekly only)
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

type Row = typeof automations.$inferSelect;
const serialize = (r: Row): Automation => ({
  id: r.id,
  name: r.name,
  prompt: r.prompt,
  frequency: r.frequency,
  hour: r.hour,
  minute: r.minute,
  weekday: r.weekday,
  enabled: r.enabled,
  lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

export async function listAutomations(): Promise<Automation[]> {
  const rows = await db.select().from(automations).orderBy(asc(automations.createdAt));
  return rows.map(serialize);
}

export interface AutomationInput {
  name: string;
  prompt: string;
  frequency: Frequency;
  hour: number;
  minute: number;
  weekday?: number;
}

const clampInt = (n: unknown, lo: number, hi: number, d: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};

export async function createAutomation(input: AutomationInput): Promise<Automation> {
  const [row] = await db
    .insert(automations)
    .values({
      name: input.name.trim().slice(0, 80) || "Untitled automation",
      prompt: input.prompt.trim().slice(0, 2000),
      frequency: (["daily", "weekdays", "weekly"] as const).includes(input.frequency) ? input.frequency : "daily",
      hour: clampInt(input.hour, 0, 23, 8),
      minute: clampInt(input.minute, 0, 59, 0),
      weekday: clampInt(input.weekday, 0, 6, 1),
    })
    .returning();
  return serialize(row);
}

export async function updateAutomation(id: string, patch: Partial<AutomationInput & { enabled: boolean }>): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 80);
  if (patch.prompt !== undefined) set.prompt = patch.prompt.trim().slice(0, 2000);
  if (patch.frequency !== undefined) set.frequency = patch.frequency;
  if (patch.hour !== undefined) set.hour = clampInt(patch.hour, 0, 23, 8);
  if (patch.minute !== undefined) set.minute = clampInt(patch.minute, 0, 59, 0);
  if (patch.weekday !== undefined) set.weekday = clampInt(patch.weekday, 0, 6, 1);
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (Object.keys(set).length) await db.update(automations).set(set).where(eq(automations.id, id));
}

export async function deleteAutomation(id: string): Promise<void> {
  await db.delete(automations).where(eq(automations.id, id));
}

/** Due if: it's on/after today's scheduled time, the frequency matches today, and it hasn't
 *  already run since today's scheduled moment. The 15-min tick then runs it once per occurrence. */
function isDue(a: Row, now: Date): boolean {
  if (!a.enabled) return false;
  const dow = now.getDay();
  if (a.frequency === "weekdays" && (dow === 0 || dow === 6)) return false;
  if (a.frequency === "weekly" && dow !== a.weekday) return false;
  const schedToday = new Date(now);
  schedToday.setHours(a.hour, a.minute, 0, 0);
  if (now < schedToday) return false; // not time yet today
  if (a.lastRunAt && a.lastRunAt >= schedToday) return false; // already ran this occurrence
  return true;
}

/** Run one automation now: agent does the task, result forced into the inbox for review. */
export async function runAutomation(a: Row | Automation): Promise<void> {
  const res = await runAgent(a.prompt, [], { mode: "chat", source: "automation", persist: true });
  // Surface every automation result in the digest inbox (not just ones that made proposals).
  if (res.runId) {
    await db.update(agentRuns).set({ status: "pending_review" }).where(eq(agentRuns.id, res.runId));
  }
  await db.update(automations).set({ lastRunAt: new Date() }).where(eq(automations.id, a.id));
}

export async function runAutomationNow(id: string): Promise<void> {
  const [a] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
  if (a) await runAutomation(a);
}

/** The worker tick: run whatever is due right now. Returns how many ran. */
export async function runDueAutomations(): Promise<number> {
  const now = new Date();
  const rows = await db.select().from(automations).where(eq(automations.enabled, true));
  let ran = 0;
  for (const a of rows) {
    if (!isDue(a, now)) continue;
    try {
      await runAutomation(a);
      ran++;
    } catch (e) {
      console.error(`[automation] "${a.name}" failed:`, (e as Error).message);
    }
  }
  return ran;
}
