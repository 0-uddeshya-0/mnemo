/**
 * Dormant detection: nodes with high historical salience but no activity-log touch in N
 * days → "you haven't revisited X lately".
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { createInsightIfNew } from "@/lib/synthesis/insights";

export async function findDormant(days = 21): Promise<number> {
  const rows = (await db.execute(sql`
    select n.id as id, n.title as title
    from nodes n
    where n.status = 'active'
      and n.salience >= 0.6
      and n.type <> 'self'
      and n.updated_at < now() - make_interval(days => ${days})
      and not exists (
        select 1 from activity_log a
        where a.node_id = n.id and a.at > now() - make_interval(days => ${days})
      )
    order by n.salience desc
    limit 8
  `)) as unknown as Array<{ id: string; title: string }>;

  let created = 0;
  for (const r of rows) {
    const ok = await createInsightIfNew(
      "dormant",
      `You haven't revisited "${r.title}" lately`,
      { nodeId: r.id, days },
      [r.id],
    );
    if (ok) created++;
  }
  return created;
}
