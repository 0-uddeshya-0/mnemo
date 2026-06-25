import { NextResponse } from "next/server";
import { authorize, audit } from "@/lib/agent/rest";
import { agentRecentActivity } from "@/lib/agent/api";

export async function GET(req: Request) {
  const auth = await authorize(req, "read");
  if (auth instanceof Response) return auth;

  const since = new URL(req.url).searchParams.get("since") ?? undefined;
  const activity = await agentRecentActivity(since);
  await audit(auth.keyId, "api_activity", { since: since ?? null });
  return NextResponse.json({ activity });
}
