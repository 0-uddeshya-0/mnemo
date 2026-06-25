"use client";
/**
 * On-device replica orchestration: pull the snapshot, search it offline, and flush queued
 * captures when back online. Offline search is keyword-based over the cached graph (works
 * with zero network and no model). Semantic offline (in-browser MiniLM over the cached
 * embeddings) is the next layer — the embeddings are already in the snapshot for it.
 */
import { enqueueCapture, getSnapshot, listQueue, putSnapshot, removeFromQueue, type QueuedCapture } from "@/lib/offline/db";
import type { Snapshot, SnapshotNode } from "@/lib/offline/types";
import type { NodeType } from "@/lib/graph/constants";

export interface SyncResult {
  syncedAt: string;
  nodes: number;
  edges: number;
}

/** Pull the latest snapshot from the server and cache it on the device. */
export async function syncSnapshot(): Promise<SyncResult> {
  const res = await fetch("/api/internal/snapshot", { cache: "no-store" });
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const snapshot = (await res.json()) as Snapshot;
  await putSnapshot(snapshot);
  return { syncedAt: snapshot.syncedAt, nodes: snapshot.nodes.length, edges: snapshot.edges.length };
}

export async function getCachedMeta(): Promise<{ syncedAt: string; nodes: number } | null> {
  const snap = await getSnapshot();
  return snap ? { syncedAt: snap.syncedAt, nodes: snap.nodes.length } : null;
}

export interface OfflineResult {
  id: string;
  title: string;
  type: NodeType;
  summary: string | null;
  salience: number;
  status: string;
  degree: number;
}

function toResult(n: SnapshotNode, degree: number): OfflineResult {
  return { id: n.id, title: n.title, type: n.type, summary: n.summary, salience: n.salience, status: n.status, degree };
}

const RRF_K = 60;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/**
 * Hybrid search over the cached snapshot, fully offline. Keyword always; semantic too when
 * `opts.semantic` and the in-browser MiniLM is available (cosine over the cached, L2-
 * normalized embeddings). The two lists are fused with Reciprocal Rank Fusion — the same
 * ranking the server uses online.
 */
export async function offlineSearch(
  query: string,
  limit = 25,
  opts: { semantic?: boolean } = {},
): Promise<OfflineResult[]> {
  const snap = await getSnapshot();
  if (!snap) return [];

  const degree = new Map<string, number>();
  for (const e of snap.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  const active = snap.nodes.filter((n) => n.status === "active" && n.type !== "self");
  const q = query.trim();
  if (!q) {
    return [...active]
      .sort((a, b) => b.salience - a.salience)
      .slice(0, limit)
      .map((n) => toResult(n, degree.get(n.id) ?? 0));
  }
  const byId = new Map(active.map((n) => [n.id, n]));

  // ── keyword ranks ───────────────────────────────────────────────────────
  const ql = q.toLowerCase();
  const tokens = ql.match(/[a-z0-9]+/g) ?? [];
  const keyword: { id: string; score: number }[] = [];
  for (const n of active) {
    const hay = `${n.title}\n${n.summary ?? ""}\n${n.body ?? ""}`.toLowerCase();
    let score = 0;
    if (n.title.toLowerCase().includes(ql)) score += 6;
    for (const t of tokens) if (hay.includes(t)) score += 1;
    if (score > 0) keyword.push({ id: n.id, score: score + n.salience * 0.5 });
  }
  keyword.sort((a, b) => b.score - a.score);

  // ── semantic ranks (in-browser query embedding × cached vectors) ──────────
  let semantic: { id: string }[] = [];
  if (opts.semantic) {
    try {
      const { embedQueryInBrowser } = await import("@/lib/offline/embed-browser");
      const qv = await embedQueryInBrowser(q);
      semantic = active
        .filter((n) => n.embedding && n.embedding.length === qv.length)
        .map((n) => ({ id: n.id, score: dot(qv, n.embedding!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 60);
    } catch {
      semantic = [];
    }
  }

  if (semantic.length === 0) {
    return keyword
      .slice(0, limit)
      .map(({ id }) => toResult(byId.get(id)!, degree.get(id) ?? 0));
  }

  // ── Reciprocal Rank Fusion ────────────────────────────────────────────────
  const fused = new Map<string, number>();
  keyword.slice(0, 60).forEach((x, i) => fused.set(x.id, (fused.get(x.id) ?? 0) + 1 / (RRF_K + i + 1)));
  semantic.forEach((x, i) => fused.set(x.id, (fused.get(x.id) ?? 0) + 1 / (RRF_K + i + 1)));
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => toResult(byId.get(id)!, degree.get(id) ?? 0));
}

/** Warm the in-browser embedder so semantic offline search works with zero network. */
export async function prepareOfflineSemantic(onProgress?: (fraction: number) => void): Promise<void> {
  const { warmBrowserEmbedder } = await import("@/lib/offline/embed-browser");
  await warmBrowserEmbedder(onProgress);
}

/** Queue a capture while offline; flushed to the server when back online. */
export async function queueCapture(payload: QueuedCapture["payload"]): Promise<void> {
  await enqueueCapture({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload,
  });
}

export async function flushQueue(): Promise<number> {
  const items = await listQueue();
  let flushed = 0;
  for (const item of items) {
    try {
      const res = await fetch("/api/internal/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (res.ok) {
        await removeFromQueue(item.id);
        flushed++;
      }
    } catch {
      break; // still offline — stop trying
    }
  }
  return flushed;
}

export async function pendingCount(): Promise<number> {
  return (await listQueue()).length;
}
