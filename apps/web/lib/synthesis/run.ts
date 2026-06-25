/**
 * Synthesis orchestrator. Runs the four analyses over the active graph and writes
 * `insights` rows. Triggered nightly + on demand via the pg-boss synthesis queue.
 */
import { clearRegenerableInsights } from "@/lib/synthesis/insights";
import { consolidateDuplicates } from "@/lib/synthesis/consolidate";
import { runClustering } from "@/lib/synthesis/cluster";
import { findContradictions } from "@/lib/synthesis/contradictions";
import { findGaps } from "@/lib/synthesis/gaps";
import { findDormant } from "@/lib/synthesis/dormant";
import { buildPersona } from "@/lib/agent/persona";

export interface SynthesisSummary {
  merged: number;
  clusters: number;
  contradictions: number;
  gaps: number;
  dormant: number;
}

export async function runSynthesis(_trigger: "manual" | "nightly"): Promise<SynthesisSummary> {
  await clearRegenerableInsights();
  // Sleep first: merge accumulated near-duplicates so everything downstream (clusters,
  // salience, persona) reasons over a clean, de-bloated graph rather than clones.
  const merged = await consolidateDuplicates().catch((e) => {
    console.error("[synthesis] consolidation failed:", (e as Error).message);
    return 0;
  });
  const clusters = await runClustering();
  const contradictions = await findContradictions();
  const gaps = await findGaps(clusters);
  const dormant = await findDormant();
  // Re-model who you are + how you reason, so MNEMO's sense of you evolves as the graph grows.
  await buildPersona().catch((e) => console.error("[synthesis] persona rebuild failed:", (e as Error).message));
  return { merged, clusters: clusters.length, contradictions, gaps, dormant };
}
