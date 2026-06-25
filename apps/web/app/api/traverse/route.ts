import { NextResponse } from "next/server";
import { authorize, audit } from "@/lib/agent/rest";
import { agentTraverse } from "@/lib/agent/api";
import { EDGE_TYPES, type EdgeType } from "@/lib/graph/constants";

export async function GET(req: Request) {
  const auth = await authorize(req, "read");
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const startId = url.searchParams.get("start_id");
  if (!startId) return NextResponse.json({ error: "Missing ?start_id" }, { status: 400 });

  const edgeParam = url.searchParams.get("edge_types");
  const edgeTypes = edgeParam
    ? (edgeParam.split(",").filter((t) => (EDGE_TYPES as readonly string[]).includes(t)) as EdgeType[])
    : undefined;
  const maxHops = Number(url.searchParams.get("max_hops") ?? 2) || 2;

  const hits = await agentTraverse(startId, { edgeTypes, maxHops });
  await audit(auth.keyId, "api_traverse", { startId, count: hits.length });
  return NextResponse.json({ hits });
}
