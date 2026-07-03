/**
 * Vault sync — a two-way bridge between the brain and a folder of markdown files (an Obsidian
 * vault, Logseq dir, or plain notes folder).
 *
 *   import: new/changed .md files in the vault are ingested as owner-authored notes
 *           (tracked by content hash in vault_files, so each version ingests once).
 *   export: the graph is written to <vault>/MNEMO/<type>/<title>.md with YAML frontmatter and
 *           [[wikilinks]] for edges — browsable/linkable in Obsidian's own graph.
 *
 * Loop safety: exports live under MNEMO/ which the import scan skips. Privacy: private node
 * bodies are NOT exported to plaintext markdown (they stay encrypted in the DB); the file
 * carries a marker instead.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { edges, nodes, vaultFiles } from "@/lib/db/schema";
import { enqueueIngest } from "@/lib/pipeline/ingest";
import { getVaultSettings } from "@/lib/settings";
import { maybeDecryptBody } from "@/lib/crypto";

const EXPORT_DIR = "MNEMO"; // exports live here; the import scan skips it (no feedback loop)
const MAX_IMPORTS_PER_SYNC = 20; // bound LLM load per tick
const MD_LIMIT = 200_000; // skip absurd files

export interface VaultSyncResult {
  imported: number;
  exported: number;
  skipped: boolean;
}

export async function syncVault(): Promise<VaultSyncResult> {
  const cfg = await getVaultSettings();
  const root = cfg.path.trim();
  if (!root || !existsSync(root)) return { imported: 0, exported: 0, skipped: true };

  const imported = cfg.importEnabled ? await importVault(root) : 0;
  const exported = cfg.exportEnabled ? await exportVault(root) : 0;
  return { imported, exported, skipped: false };
}

// ── import: vault → brain ────────────────────────────────────────────────────
async function listMarkdown(dir: string, root: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .obsidian, .trash, dotfiles
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (relative(root, p) === EXPORT_DIR) continue; // never re-ingest our own exports
      await listMarkdown(p, root, out);
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

async function importVault(root: string): Promise<number> {
  const files = await listMarkdown(root, root);
  if (files.length === 0) return 0;

  const known = new Map(
    (await db.select().from(vaultFiles).where(inArray(vaultFiles.path, files))).map((r) => [r.path, r.hash]),
  );

  let imported = 0;
  for (const path of files) {
    if (imported >= MAX_IMPORTS_PER_SYNC) break;
    const s = await stat(path);
    if (s.size > MD_LIMIT || s.size === 0) continue;
    const body = await readFile(path, "utf8");
    if (!body.trim()) continue;
    const hash = createHash("sha256").update(body).digest("hex");
    if (known.get(path) === hash) continue; // unchanged

    const title = path.split("/").pop()!.replace(/\.(md|markdown)$/i, "");
    await enqueueIngest({ kind: "note", title, body, ownerAuthored: true });
    await db
      .insert(vaultFiles)
      .values({ path, hash })
      .onConflictDoUpdate({ target: vaultFiles.path, set: { hash, ingestedAt: new Date() } });
    imported++;
  }
  return imported;
}

// ── export: brain → vault/MNEMO/ ─────────────────────────────────────────────
const safe = (t: string) =>
  t.replace(/[/\\:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";

async function exportVault(root: string): Promise<number> {
  const all = await db
    .select({
      id: nodes.id,
      type: nodes.type,
      title: nodes.title,
      summary: nodes.summary,
      body: nodes.body,
      sensitivity: nodes.sensitivity,
      confidence: nodes.confidence,
      salience: nodes.salience,
      updatedAt: nodes.updatedAt,
    })
    .from(nodes)
    .where(eq(nodes.status, "active"));
  if (all.length === 0) return 0;

  const allEdges = await db
    .select({ src: edges.src, dst: edges.dst, type: edges.type })
    .from(edges);
  const titleById = new Map(all.map((n) => [n.id, safe(n.title)]));
  const linksFor = new Map<string, string[]>();
  for (const e of allEdges) {
    const s = titleById.get(e.src);
    const t = titleById.get(e.dst);
    if (!s || !t) continue;
    (linksFor.get(e.src) ?? linksFor.set(e.src, []).get(e.src)!).push(`- ${e.type} → [[${t}]]`);
    (linksFor.get(e.dst) ?? linksFor.set(e.dst, []).get(e.dst)!).push(`- ${e.type} ← [[${s}]]`);
  }

  let written = 0;
  for (const n of all) {
    if (n.type === "self") continue;
    const dir = join(root, EXPORT_DIR, n.type);
    await mkdir(dir, { recursive: true });
    const isPrivate = n.sensitivity === "private";
    // Private bodies stay encrypted in the DB — never written to plaintext markdown.
    const body = isPrivate ? "> 🔒 Private — body stays encrypted inside MNEMO." : ((await maybeDecryptBody(n.body)) ?? "");
    const fm = [
      "---",
      `type: ${n.type}`,
      `confidence: ${n.confidence}`,
      `salience: ${Number(n.salience).toFixed(2)}`,
      `updated: ${n.updatedAt.toISOString().slice(0, 10)}`,
      "source: MNEMO",
      "---",
    ].join("\n");
    const md = [
      fm,
      `# ${n.title}`,
      n.summary && n.summary !== body ? `\n> ${n.summary}\n` : "",
      body,
      linksFor.get(n.id)?.length ? `\n## Connections\n${[...new Set(linksFor.get(n.id))].join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const dest = join(dir, `${safe(n.title)}.md`);
    // only touch the file when content changed (keeps mtimes/Obsidian indexing calm)
    const prev = existsSync(dest) ? await readFile(dest, "utf8").catch(() => "") : "";
    if (prev !== md) {
      await writeFile(dest, md, "utf8");
      written++;
    }
  }
  return written;
}

/** Guard for the settings UI: the path must exist and be a directory. */
export async function validateVaultPath(path: string): Promise<{ ok: boolean; error?: string }> {
  const p = resolve(path.trim());
  if (!p) return { ok: false, error: "Give me a folder path." };
  try {
    const s = await stat(p);
    return s.isDirectory() ? { ok: true } : { ok: false, error: "That's a file, not a folder." };
  } catch {
    return { ok: false, error: "Folder doesn't exist." };
  }
}
