/** Owner-session capture (used to flush the on-device offline write queue). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth/session";
import { enqueueIngest } from "@/lib/pipeline/ingest";

const Schema = z.union([
  z.object({ kind: z.literal("note"), title: z.string().optional(), body: z.string().min(1) }),
  z.object({ kind: z.literal("url"), url: z.string().url() }),
]);

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const data = parsed.data;
  const { ingestJobId } =
    data.kind === "url"
      ? await enqueueIngest({ kind: "url", url: data.url })
      : await enqueueIngest({ kind: "note", title: data.title, body: data.body, ownerAuthored: true });
  return NextResponse.json({ ingestJobId }, { status: 202 });
}
