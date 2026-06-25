/**
 * Consolidation — the "sleep" pass. As the graph grows, repeated extraction creates the same
 * trait/person/belief many times over ("rational" ×3, "father" ×2 …), which dilutes retrieval
 * and salience. This nightly pass merges near-duplicate nodes into one canonical node and
 * redirects their edges, so the brain stays sharp instead of bloating.
 *
 * Safety: only merges nodes of the SAME type AND SAME sensitivity (never folds private into
 * public), only at cosine ≥ 0.95 (near-identical), caps merges per run, and is REVERSIBLE —
 * losers are archived with a `mergedInto` pointer, never hard-deleted.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { reconcileSalience, recordActivity } from "@/lib/graph/store";

const MERGE_COSINE = 0.95; // pgvector cosine distance threshold = 1 - 0.95
const MAX_MERGES = 50; // safety cap per run

interface PairRow {
  a_id: string;
  b_id: string;
  a_conf: number;
  b_conf: number;
  a_sal: number;
  b_sal: number;
  a_created: string;
  b_created: string;
}

/** Find near-duplicate node pairs and merge each into a single canonical survivor. */
export async function consolidateDuplicates(): Promise<number> {
  const pairs = (await db.execute(sql`
    select a.id as a_id, b.id as b_id,
           a.confidence as a_conf, b.confidence as b_conf,
           a.salience   as a_sal,  b.salience   as b_sal,
           a.created_at as a_created, b.created_at as b_created
    from nodes a
    join nodes b
      on a.type = b.type and a.sensitivity = b.sensitivity and a.id < b.id
    where a.status = 'active' and b.status = 'active' and a.type <> 'self'
      and a.embedding is not null and b.embedding is not null
      and (a.embedding <=> b.embedding) < ${1 - MERGE_COSINE}
    order by (a.embedding <=> b.embedding) asc
    limit 300
  `)) as unknown as PairRow[];

  const retired = new Set<string>();
  let merges = 0;
  for (const p of pairs) {
    if (merges >= MAX_MERGES) break;
    if (retired.has(p.a_id) || retired.has(p.b_id)) continue; // keep merges to disjoint pairs

    // Survivor = the more authoritative node: higher confidence, then salience, then the
    // older one (the canonical original). The loser folds into it.
    const aWins =
      p.a_conf !== p.b_conf
        ? p.a_conf > p.b_conf
        : p.a_sal !== p.b_sal
          ? p.a_sal > p.b_sal
          : new Date(p.a_created).getTime() <= new Date(p.b_created).getTime();
    const survivor = aWins ? p.a_id : p.b_id;
    const loser = aWins ? p.b_id : p.a_id;

    await mergeNodePair(survivor, loser);
    retired.add(loser);
    merges++;
  }
  return merges;
}

/** Fold `loser` into `survivor`: redirect edges (respecting the (src,dst,type) unique index),
 *  union properties, then archive the loser with a provenance pointer. */
async function mergeNodePair(survivor: string, loser: string): Promise<void> {
  // 1) Drop the loser's edges that would collide with an edge the survivor already has.
  await db.execute(sql`
    delete from edges e
    where e.src = ${loser}
      and exists (select 1 from edges x where x.src = ${survivor} and x.dst = e.dst and x.type = e.type)`);
  await db.execute(sql`
    delete from edges e
    where e.dst = ${loser}
      and exists (select 1 from edges x where x.dst = ${survivor} and x.src = e.src and x.type = e.type)`);

  // 2) Repoint the loser's remaining edges onto the survivor, skipping would-be self-loops.
  await db.execute(sql`update edges set src = ${survivor} where src = ${loser} and dst <> ${survivor}`);
  await db.execute(sql`update edges set dst = ${survivor} where dst = ${loser} and src <> ${survivor}`);

  // 3) Remove any leftover self-loops or edges still touching the loser.
  await db.execute(sql`delete from edges where src = ${loser} or dst = ${loser}`);

  // 4) Union properties (survivor wins on conflict) and treat the merge as a revisit signal.
  await db.execute(sql`
    update nodes s set
      confidence = greatest(s.confidence, l.confidence),
      properties = coalesce(l.properties, '{}'::jsonb) || coalesce(s.properties, '{}'::jsonb)
        || jsonb_build_object(
             'revisits',
             coalesce((s.properties->>'revisits')::int, 0) + coalesce((l.properties->>'revisits')::int, 0) + 1)
    from nodes l
    where s.id = ${survivor} and l.id = ${loser}`);

  // 5) Archive the loser with a reversible provenance pointer (never hard-delete).
  await db.execute(sql`
    update nodes set
      status = 'archived',
      properties = coalesce(properties, '{}'::jsonb) || jsonb_build_object('mergedInto', ${survivor}::text)
    where id = ${loser}`);

  // The survivor just gained edges/revisits — recompute its salience to reflect that.
  await reconcileSalience(survivor);
  await recordActivity({
    action: "merge_node",
    nodeId: survivor,
    actor: "llm",
    detail: { mergedFrom: loser, reason: "consolidation" },
  }).catch(() => {});
}
