"use server";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertOwner } from "@/lib/auth/guard";
import { enqueueIngest } from "@/lib/pipeline/ingest";

type CaptureResult = { ok: true; ingestJobId: string } | { ok: false; error: string };

const NoteSchema = z.object({
  title: z.string().optional(),
  body: z.string().min(1, "Write something first."),
  nodeType: z.enum(["note", "creative_work", "belief", "quote"]).default("note"),
  sensitivity: z.enum(["public", "normal", "private"]).default("normal"),
});

export async function captureNote(input: z.infer<typeof NoteSchema>): Promise<CaptureResult> {
  await assertOwner();
  const parsed = NoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
  const { title, body, nodeType, sensitivity } = parsed.data;
  const { ingestJobId } = await enqueueIngest({
    kind: "note",
    title,
    body,
    nodeType,
    sensitivity,
    ownerAuthored: true,
  });
  return { ok: true, ingestJobId };
}

const UrlSchema = z.object({
  url: z.string().url("Enter a valid URL."),
  note: z.string().optional(),
});

export async function captureUrl(input: z.infer<typeof UrlSchema>): Promise<CaptureResult> {
  await assertOwner();
  const parsed = UrlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid URL." };
  const { ingestJobId } = await enqueueIngest({ kind: "url", ...parsed.data });
  return { ok: true, ingestJobId };
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB

export async function captureFile(formData: FormData): Promise<CaptureResult> {
  await assertOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (file.size === 0) return { ok: false, error: "File is empty." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "File too large (max 25MB)." };

  const dir = join(tmpdir(), "mnemosyne-uploads");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}-${file.name.replace(/[^\w.\-]+/g, "_")}`);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));

  const { ingestJobId } = await enqueueIngest({
    kind: "file",
    path,
    filename: file.name,
    mime: file.type || undefined,
  });
  return { ok: true, ingestJobId };
}
