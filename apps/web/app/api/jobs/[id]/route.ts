import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ingestJobs } from "@/lib/db/schema";

// Owner-only job status poll for the capture progress UI.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const [job] = await db
    .select({
      id: ingestJobs.id,
      kind: ingestJobs.kind,
      status: ingestJobs.status,
      stage: ingestJobs.stage,
      result: ingestJobs.result,
      error: ingestJobs.error,
      createdAt: ingestJobs.createdAt,
    })
    .from(ingestJobs)
    .where(eq(ingestJobs.id, id))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}
