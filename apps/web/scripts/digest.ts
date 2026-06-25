/**
 * Run MNEMO's daily digest on demand (the same pass the worker schedules at 08:00).
 * Useful for testing or when you want MNEMO to review your brain right now.
 *
 *   pnpm digest
 */
import "@/lib/server/load-env";
import { runDailyDigest } from "@/lib/agent/digest";

async function main() {
  console.log("→ MNEMO daily digest …");
  const result = await runDailyDigest();
  if (!result.ran) {
    console.log(`· skipped — ${result.reason}`);
    return;
  }
  console.log(`✓ digest done — ${result.proposals} proposal(s) queued for review (run ${result.runId}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ digest failed:", err);
    process.exit(1);
  });
