/**
 * Hybrid search: keyword (full-text `tsv` + trigram title) and semantic (embedding kNN
 * over nodes AND chunks) run in parallel, merged via Reciprocal Rank Fusion. Owner-facing
 * (returns everything); agent search applies agentVisibleFilter separately.
 */
import { sql } from "drizzle-orm";
import { db, toPgArray, toVectorLiteral } from "@/lib/db";
import { embed } from "@/lib/embeddings";
import type { NodeType } from "@/lib/graph/constants";

const RRF_K = 60;

export interface SearchResult {
  id: string;
  title: string;
  type: NodeType;
  summary: string | null;
  confidence: number;
  salience: number;
  status: string;
  sensitivity: string;
  degree: number;
  score: number;
  matchedVia: "keyword" | "semantic" | "both";
}

export interface SearchOptions {
  types?: NodeType[];
  limit?: number;
  /** Restrict to active nodes only (default true). */
  activeOnly?: boolean;
}

interface IdRank {
  id: string;
  rank: number;
}

export async function hybridSearch(
  rawQuery: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  const limit = opts.limit ?? 25;
  const poolSize = Math.max(limit * 2, 40);
  const activeFilter = opts.activeOnly === false ? sql`true` : sql`n.status = 'active'`;

  // Empty query → most salient nodes (palette default state).
  if (!query) {
    const rows = (await db.execute(sql`
      select n.id, n.title, n.type, n.summary, n.confidence, n.salience, n.status, n.sensitivity,
             (select count(*) from edges e where e.src = n.id or e.dst = n.id)::int as degree
      from nodes n
      where ${activeFilter} and n.type <> 'self'
      ${opts.types?.length ? sql`and n.type = any(${toPgArray(opts.types)}::text[])` : sql``}
      order by n.salience desc, n.updated_at desc
      limit ${limit}
    `)) as unknown as RowBase[];
    return rows.map((r) => ({ ...normalizeRow(r), score: r.salience, matchedVia: "keyword" }));
  }

  // ── keyword list (full-text + trigram) ───────────────────────────────────
  const keywordRows = (await db.execute(sql`
    select n.id
    from nodes n
    where ${activeFilter}
      and (n.tsv @@ websearch_to_tsquery('english', ${query}) or n.title % ${query})
    order by (
      ts_rank(n.tsv, websearch_to_tsquery('english', ${query})) + similarity(n.title, ${query})
    ) desc
    limit ${poolSize}
  `)) as unknown as Array<{ id: string }>;
  const keywordRanks: IdRank[] = keywordRows.map((r, i) => ({ id: r.id, rank: i }));

  // ── semantic list (nodes + chunks) ───────────────────────────────────────
  const [qvec] = await embed([query]);
  const semanticRanks: IdRank[] = [];
  if (qvec) {
    const lit = toVectorLiteral(qvec);
    const semRows = (await db.execute(sql`
      with node_hits as (
        select n.id, (n.embedding <=> ${lit}::vector) as dist
        from nodes n
        where n.embedding is not null and ${activeFilter}
        order by n.embedding <=> ${lit}::vector
        limit ${poolSize}
      ),
      chunk_hits as (
        select c.node_id as id, min(c.embedding <=> ${lit}::vector) as dist
        from chunks c
        join nodes n on n.id = c.node_id
        where c.embedding is not null and ${activeFilter}
        group by c.node_id
        order by dist
        limit ${poolSize}
      )
      select id, min(dist) as dist from (
        select id, dist from node_hits
        union all
        select id, dist from chunk_hits
      ) u
      group by id
      order by dist
      limit ${poolSize}
    `)) as unknown as Array<{ id: string }>;
    semRows.forEach((r, i) => semanticRanks.push({ id: r.id, rank: i }));
  }

  // ── Reciprocal Rank Fusion ───────────────────────────────────────────────
  const scores = new Map<string, number>();
  const inKeyword = new Set(keywordRanks.map((r) => r.id));
  const inSemantic = new Set(semanticRanks.map((r) => r.id));
  for (const { id, rank } of [...keywordRanks, ...semanticRanks]) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  }
  if (scores.size === 0) return [];

  // Re-rank over a wider candidate pool (not just the top `limit`), so a salient/recent memory
  // ranked just below the RRF cut can still surface. Fetch metadata for the candidates first.
  const candidateIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, poolSize)
    .map(([id]) => id);

  const metaRows = (await db.execute(sql`
    select n.id, n.title, n.type, n.summary, n.confidence, n.salience, n.status, n.sensitivity,
           extract(epoch from n.updated_at) as updated_epoch,
           (select count(*) from edges e where e.src = n.id or e.dst = n.id)::int as degree
    from nodes n
    where n.id = any(${toPgArray(candidateIds)}::uuid[])
    ${opts.types?.length ? sql`and n.type = any(${toPgArray(opts.types)}::text[])` : sql``}
  `)) as unknown as Array<RowBase & { updated_epoch: number }>;
  const metaById = new Map(metaRows.map((r) => [r.id, r]));

  // Blend: relevance (RRF) still leads, but salience, recency, and owner-asserted confidence
  // gently lift a memory — so MNEMO recalls what matters and what's current, not just what
  // lexically matched. Recency uses a 180-day half-life so old facts fade slowly, never vanish.
  const now = Date.now() / 1000;
  const HALF_LIFE = 180 * 86400;
  const results: SearchResult[] = [];
  for (const id of candidateIds) {
    const meta = metaById.get(id);
    if (!meta) continue; // filtered out by type
    const via: SearchResult["matchedVia"] =
      inKeyword.has(id) && inSemantic.has(id) ? "both" : inSemantic.has(id) ? "semantic" : "keyword";
    const rrf = scores.get(id) ?? 0;
    const salience = Number(meta.salience);
    const recency = Math.pow(0.5, Math.max(0, now - Number(meta.updated_epoch)) / HALF_LIFE);
    const ownerAsserted = Number(meta.confidence) >= 0.999 ? 1 : 0;
    const blended = rrf * (1 + 0.6 * salience + 0.3 * recency + 0.25 * ownerAsserted);
    results.push({ ...normalizeRow(meta), score: blended, matchedVia: via });
  }
  return results.sort((a, b) => b.score - a.score || b.confidence - a.confidence).slice(0, limit);
}

interface RowBase {
  id: string;
  title: string;
  type: NodeType;
  summary: string | null;
  confidence: number;
  salience: number;
  status: string;
  sensitivity: string;
  degree: number;
}

function normalizeRow(r: RowBase) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    summary: r.summary,
    confidence: Number(r.confidence),
    salience: Number(r.salience),
    status: r.status,
    sensitivity: r.sensitivity,
    degree: Number(r.degree),
  };
}
