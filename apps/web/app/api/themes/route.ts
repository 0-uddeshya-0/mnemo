import { NextResponse } from "next/server";
import { authorize, audit } from "@/lib/agent/rest";
import { agentMyThemes } from "@/lib/agent/api";

export async function GET(req: Request) {
  const auth = await authorize(req, "read");
  if (auth instanceof Response) return auth;

  const themes = await agentMyThemes();
  await audit(auth.keyId, "api_themes", { count: themes.length });
  return NextResponse.json({ themes });
}
