import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize, audit } from "@/lib/agent/rest";
import { agentAddKnowledge } from "@/lib/agent/api";
import { EDGE_TYPES, NODE_TYPES } from "@/lib/graph/constants";

const BodySchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  type: z.enum(NODE_TYPES),
  links: z.array(z.object({ to: z.string().uuid(), type: z.enum(EDGE_TYPES) })).optional(),
});

export async function POST(req: Request) {
  const auth = await authorize(req, "write");
  if (auth instanceof Response) return auth;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const { id } = await agentAddKnowledge(parsed.data, auth.keyId);
  await audit(auth.keyId, "api_add_knowledge", { id, type: parsed.data.type });
  return NextResponse.json({ id }, { status: 201 });
}
