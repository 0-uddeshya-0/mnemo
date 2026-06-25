/** Owner-session photo upload. Saves images to the Mac and enqueues the vision job
 * (MNEMO looks at each and turns it into a memory). Images never leave the device. */
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { savePhoto } from "@/lib/photos";
import { getBoss, QUEUES } from "@/lib/queue";

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const note = String(form.get("note") ?? "").slice(0, 500);
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No image uploaded." }, { status: 400 });

  const boss = await getBoss();
  let queued = 0;
  for (const file of files) {
    if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) continue;
    const ext = file.name.split(".").pop() || file.type.split("/")[1] || "jpg";
    const buf = Buffer.from(await file.arrayBuffer());
    const name = await savePhoto(buf, ext);
    await boss.send(QUEUES.vision, { photoName: name, userNote: note || undefined });
    queued++;
  }
  if (queued === 0) return NextResponse.json({ error: "No usable image (≤20MB)." }, { status: 400 });
  return NextResponse.json({ ok: true, queued }, { status: 202 });
}
