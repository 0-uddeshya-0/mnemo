import { NextResponse } from "next/server";
import { authorize, audit } from "@/lib/agent/rest";
import { agentSearch } from "@/lib/agent/api";
import { NODE_TYPES, type NodeType } from "@/lib/graph/constants";

export async function GET(req: Request) {
  const auth = await authorize(req, "read");
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
  if (!query.trim()) return NextResponse.json({ error: "Missing ?q" }, { status: 400 });

  const typesParam = url.searchParams.get("types");
  const types = typesParam
    ? (typesParam.split(",").filter((t) => (NODE_TYPES as readonly string[]).includes(t)) as NodeType[])
    : undefined;
  const limit = Number(url.searchParams.get("limit") ?? 10) || 10;

  const results = await agentSearch(query, { types, limit });
  await audit(auth.keyId, "api_search", { query, count: results.length });
  return NextResponse.json({ results });
}
