import { NextResponse } from "next/server";
import { authorize, audit } from "@/lib/agent/rest";
import { agentGetNode } from "@/lib/agent/api";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req, "read");
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const depth = Number(new URL(req.url).searchParams.get("depth") ?? 1) || 1;
  const node = await agentGetNode(id, depth);
  if (!node) return NextResponse.json({ error: "Not found or not visible" }, { status: 404 });

  await audit(auth.keyId, "api_get_node", { id });
  return NextResponse.json(node);
}
