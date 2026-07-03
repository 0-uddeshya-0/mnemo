/** Owner-session system health: GET = snapshot, POST = fix-it action (backup / warm / restart). */
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { getHealth, runHealthAction, type HealthAction } from "@/lib/health";

export const maxDuration = 300;

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getHealth());
}

const ACTIONS: HealthAction[] = ["backup", "warm_model", "restart_worker"];

export async function POST(req: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const action = ACTIONS.find((a) => a === body.action);
  if (!action) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  try {
    return NextResponse.json(await runHealthAction(action));
  } catch (e) {
    return NextResponse.json({ ok: false, detail: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
