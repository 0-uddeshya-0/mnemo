/**
 * Side-effecting module: populate process.env from the repo-root `.env` for non-Next
 * entrypoints (migrate / seed / worker / mcp). Import this FIRST, before any module
 * that reads `@/lib/env`. Next.js loads `.env` itself (see next.config.mjs), so this
 * is only for tsx scripts.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

for (const candidate of [
  resolve(process.cwd(), "../../.env"), // running from apps/web
  resolve(process.cwd(), ".env"),
]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* ignore malformed/partial env; defaults in lib/env.ts will apply */
    }
    break;
  }
}
