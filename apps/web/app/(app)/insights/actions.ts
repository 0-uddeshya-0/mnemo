"use server";
import { assertOwner } from "@/lib/auth/guard";
import { dismissInsight, getInsights, type InsightView } from "@/lib/synthesis/feed";
import { runSynthesis, type SynthesisSummary } from "@/lib/synthesis/run";
import { confirmSupersession } from "@/lib/pipeline/link";

export async function getInsightsAction(): Promise<InsightView[]> {
  await assertOwner();
  return getInsights();
}

export async function dismissInsightAction(id: string): Promise<{ ok: true }> {
  await assertOwner();
  await dismissInsight(id);
  return { ok: true };
}

export async function runSynthesisAction(): Promise<SynthesisSummary> {
  await assertOwner();
  return runSynthesis("manual");
}

export async function confirmEvolutionAction(
  newId: string,
  oldId: string,
  insightId: string,
): Promise<{ ok: true }> {
  await assertOwner();
  await confirmSupersession(newId, oldId);
  await dismissInsight(insightId);
  return { ok: true };
}

export type { InsightView };
