/** Owner-session archive upload. Stashes the export to a temp file and enqueues the
 * (LLM-heavy) distillation job for the worker. Files up to 15MB. */
import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { isAuthenticated } from "@/lib/auth/session";
import { getBoss, QUEUES } from "@/lib/queue";

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json(
      { error: "That export is over 15MB — pick a specific file (e.g. one chat, your tweets.js) rather than the whole archive." },
      { status: 413 },
    );
  }

  const content = await file.text();
  const filename = file.name || "export.txt";
  const source = String(form?.get("source") || labelFor(filename));
  const filePath = join(tmpdir(), `mnemo-import-${randomUUID()}.txt`);
  await writeFile(filePath, content, "utf8");

  const boss = await getBoss();
  await boss.send(QUEUES.archiveImport, { filePath, filename, source });

  return NextResponse.json({ ok: true, source, bytes: file.size }, { status: 202 });
}

function labelFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("tweet")) return "X archive";
  if (n.includes("conversation")) return "Claude export";
  if (n.includes("whatsapp") || n.includes("_chat")) return "WhatsApp chat";
  if (n.includes("keep")) return "Google Keep";
  if (n.endsWith(".md") || n.includes("journal") || n.includes("diary")) return "journal";
  return "personal archive";
}
