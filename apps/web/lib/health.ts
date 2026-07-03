/**
 * System health — one honest snapshot of everything MNEMO depends on (DB, model, worker,
 * queues, backups, disk, graph size), plus the three fix-it actions the owner can take from
 * the UI. Read-only checks are all best-effort with tight timeouts; a check failing IS signal.
 */
import { execFile } from "node:child_process";
import { readdir, stat, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getWorkerHeartbeat } from "@/lib/settings";

const run = promisify(execFile);
const BACKUP_ROOT = process.env.MNEMO_BACKUP_DIR || join(homedir(), "MNEMO-Backups");

export type Level = "ok" | "warn" | "down";

export interface HealthSnapshot {
  level: Level; // worst of all checks
  checks: {
    postgres: { level: Level; detail: string };
    ollama: { level: Level; detail: string };
    worker: { level: Level; detail: string };
    queues: { level: Level; detail: string };
    backup: { level: Level; detail: string };
    disk: { level: Level; detail: string };
  };
  graph: { nodes: number; edges: number };
  at: string;
}

const worst = (levels: Level[]): Level =>
  levels.includes("down") ? "down" : levels.includes("warn") ? "warn" : "ok";

export async function getHealth(): Promise<HealthSnapshot> {
  const [postgres, ollama, worker, queues, backup, disk, graph] = await Promise.all([
    checkPostgres(),
    checkOllama(),
    checkWorker(),
    checkQueues(),
    checkBackup(),
    checkDisk(),
    graphStats(),
  ]);
  const checks = { postgres, ollama, worker, queues, backup, disk };
  return {
    level: worst(Object.values(checks).map((c) => c.level)),
    checks,
    graph,
    at: new Date().toISOString(),
  };
}

async function checkPostgres() {
  try {
    await db.execute(sql`select 1`);
    return { level: "ok" as Level, detail: "connected" };
  } catch (e) {
    return { level: "down" as Level, detail: (e as Error).message.slice(0, 80) };
  }
}

async function checkOllama() {
  try {
    const base = env.OPENROUTER_BASE_URL.replace(/\/v1\/?$/, "");
    const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    const loaded = data.models?.map((m) => m.name) ?? [];
    return loaded.length
      ? { level: "ok" as Level, detail: `${loaded.join(", ")} warm` }
      : { level: "warn" as Level, detail: "up, no model loaded (first ask will be slow)" };
  } catch {
    return { level: "down" as Level, detail: "not reachable on 11434" };
  }
}

async function checkWorker() {
  const hb = await getWorkerHeartbeat().catch(() => null);
  if (!hb) return { level: "warn" as Level, detail: "no heartbeat yet" };
  const ageMin = (Date.now() - new Date(hb).getTime()) / 60_000;
  if (ageMin < 3) return { level: "ok" as Level, detail: `heartbeat ${Math.round(ageMin * 60)}s ago` };
  if (ageMin < 20) return { level: "warn" as Level, detail: `heartbeat ${Math.round(ageMin)}m ago` };
  return { level: "down" as Level, detail: `last seen ${Math.round(ageMin)}m ago — restart it` };
}

async function checkQueues() {
  try {
    const rows = (await db.execute(
      sql`select state, count(*)::int as n from pgboss.job where state in ('created','active','retry','failed') group by state`,
    )) as unknown as { state: string; n: number }[];
    const by = Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]));
    const backlog = (by.created ?? 0) + (by.retry ?? 0);
    const detail = `${by.active ?? 0} active · ${backlog} queued · ${by.failed ?? 0} failed`;
    return { level: backlog > 50 ? ("warn" as Level) : ("ok" as Level), detail };
  } catch {
    return { level: "warn" as Level, detail: "queue table not readable" };
  }
}

async function checkBackup() {
  try {
    const dirs = (await readdir(BACKUP_ROOT)).filter((d) => d.startsWith("mnemo-")).sort();
    const latest = dirs.at(-1);
    if (!latest) return { level: "warn" as Level, detail: "no backups yet — run one" };
    const s = await stat(join(BACKUP_ROOT, latest));
    const ageH = (Date.now() - s.mtimeMs) / 3_600_000;
    if (ageH < 30) return { level: "ok" as Level, detail: `latest ${Math.round(ageH)}h ago` };
    return { level: "warn" as Level, detail: `latest ${Math.round(ageH / 24)}d ago` };
  } catch {
    return { level: "warn" as Level, detail: "no backups yet — run one" };
  }
}

async function checkDisk() {
  try {
    const fs = await statfs(homedir());
    const freeGB = (fs.bavail * fs.bsize) / 1e9;
    const detail = `${freeGB.toFixed(0)} GB free`;
    return { level: freeGB < 5 ? ("down" as Level) : freeGB < 15 ? ("warn" as Level) : ("ok" as Level), detail };
  } catch {
    return { level: "warn" as Level, detail: "unknown" };
  }
}

async function graphStats() {
  try {
    const [r] = (await db.execute(
      sql`select (select count(*)::int from nodes where status='active') as nodes, (select count(*)::int from edges) as edges`,
    )) as unknown as { nodes: number; edges: number }[];
    return { nodes: Number(r?.nodes ?? 0), edges: Number(r?.edges ?? 0) };
  } catch {
    return { nodes: 0, edges: 0 };
  }
}

// ── actions ──────────────────────────────────────────────────────────────────
export type HealthAction = "backup" | "warm_model" | "restart_worker";

export async function runHealthAction(action: HealthAction): Promise<{ ok: boolean; detail: string }> {
  switch (action) {
    case "warm_model": {
      const base = env.OPENROUTER_BASE_URL.replace(/\/v1\/?$/, "");
      const model = env.LLM_MODEL.split(",")[0].trim();
      const res = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: "ok", keep_alive: -1, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
      return res.ok ? { ok: true, detail: `${model} warm (kept forever)` } : { ok: false, detail: `ollama ${res.status}` };
    }
    case "restart_worker": {
      const uid = process.getuid?.() ?? 501;
      await run("launchctl", ["kickstart", "-k", `gui/${uid}/com.mnemo.worker`]);
      return { ok: true, detail: "worker restarting" };
    }
    case "backup": {
      // the script lives alongside the app; runs pg_dump + photos tar with rotation
      const script = join(process.cwd(), "scripts", "mnemo-backup.sh");
      const { stdout } = await run("bash", [script, "backup"], { timeout: 300_000 });
      return { ok: true, detail: stdout.trim().split("\n").at(-1) ?? "backup done" };
    }
  }
}
