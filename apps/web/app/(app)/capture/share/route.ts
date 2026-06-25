/** PWA share_target endpoint (§1.2). The OS share sheet POSTs here; we enqueue an ingest. */
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { enqueueIngest } from "@/lib/pipeline/ingest";

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const form = await req.formData();
  const title = (form.get("title") as string) || undefined;
  const text = (form.get("text") as string) || undefined;
  const url = (form.get("url") as string) || undefined;
  const file = form.get("file");

  if (file instanceof File && file.size > 0) {
    const dir = join(tmpdir(), "mnemosyne-uploads");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}-${file.name.replace(/[^\w.\-]+/g, "_")}`);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    await enqueueIngest({ kind: "file", path, filename: file.name, mime: file.type || undefined });
  } else {
    await enqueueIngest({ kind: "share", title, text, url });
  }

  return NextResponse.redirect(new URL("/capture?shared=1", req.url), 303);
}
