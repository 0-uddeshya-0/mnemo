/** Bearer-auth capture endpoint used by the browser extension (save page / selection). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize, audit } from "@/lib/agent/rest";
import { enqueueIngest } from "@/lib/pipeline/ingest";

const Schema = z
  .object({
    url: z.string().url().optional(),
    text: z.string().optional(),
    title: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((d) => Boolean(d.url || d.text), { message: "Provide a url or text." });

export async function POST(req: Request) {
  const auth = await authorize(req, "write");
  if (auth instanceof Response) return auth;

  const json = await req.json().catch(() => null);
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { url, text, title, note } = parsed.data;
  const { ingestJobId } = url
    ? await enqueueIngest({ kind: "url", url, note })
    : await enqueueIngest({ kind: "note", title, body: text ?? "", ownerAuthored: true });

  await audit(auth.keyId, "api_capture", { url: url ?? null });
  return NextResponse.json({ ingestJobId }, { status: 202 });
}
