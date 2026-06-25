/**
 * Photo storage on the Mac (never the cloud). Files live in <repo>/data/photos and are
 * served back only through a session-authed route. The stored filename doubles as the id.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

const DIR = resolve(process.cwd(), "../../data/photos");

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
};

const SAFE_NAME = /^[a-f0-9-]+\.[a-z0-9]{2,5}$/i;

export async function savePhoto(buf: Buffer, ext: string): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const safeExt = (ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const name = `${randomUUID()}.${safeExt}`;
  await writeFile(join(DIR, name), buf);
  return name;
}

export function photoFsPath(name: string): string | null {
  if (!SAFE_NAME.test(name)) return null; // no path traversal
  return join(DIR, name);
}

export function photoExists(name: string): boolean {
  const p = photoFsPath(name);
  return !!p && existsSync(p);
}

export function photoMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "jpg";
  return EXT_MIME[ext] ?? "image/jpeg";
}

export async function photoBuffer(name: string): Promise<Buffer> {
  const p = photoFsPath(name);
  if (!p) throw new Error("bad photo name");
  return readFile(p);
}

export async function photoDataUri(name: string): Promise<string> {
  const buf = await photoBuffer(name);
  return `data:${photoMime(name)};base64,${buf.toString("base64")}`;
}
