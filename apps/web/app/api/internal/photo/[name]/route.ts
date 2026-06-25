/** Serve a stored photo — owner-session only (these are private). */
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { photoExists, photoBuffer, photoMime } from "@/lib/photos";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name } = await params;
  if (!photoExists(name)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const buf = await photoBuffer(name);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "content-type": photoMime(name), "cache-control": "private, max-age=86400" },
  });
}
