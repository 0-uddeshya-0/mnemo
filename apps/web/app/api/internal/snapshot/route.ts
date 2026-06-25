/** Owner-session snapshot for the on-device replica (Phase B). Cached in IndexedDB. */
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { buildSnapshot } from "@/lib/offline/snapshot-server";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const snapshot = await buildSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
