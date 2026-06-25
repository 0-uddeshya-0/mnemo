/** The `self` singleton node — the spine everything attaches to. */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";

export async function getSelfId(): Promise<string | null> {
  const [row] = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.type, "self")).limit(1);
  return row?.id ?? null;
}

export async function ensureSelf(): Promise<string> {
  const existing = await getSelfId();
  if (existing) return existing;
  const [row] = await db
    .insert(nodes)
    .values({
      type: "self",
      title: "You",
      summary: "The owner of this second brain.",
      confidence: 1,
      salience: 1,
    })
    .onConflictDoNothing()
    .returning({ id: nodes.id });
  if (row) return row.id;
  // lost a race against the partial-unique singleton index — re-read.
  const again = await getSelfId();
  if (!again) throw new Error("ensureSelf: could not create or find the self node");
  return again;
}
