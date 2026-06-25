/**
 * POST /api/agent — talk to MNEMO over REST. This is the bridge Siri uses: a Shortcut
 * POSTs `{ task }` with a bearer API key and speaks back `spoken`. The agent reads freely
 * but never writes here — any write/external action is returned as a proposal and queued
 * in the inbox (status pending_review) for the owner to approve in the app.
 *
 *   curl -XPOST $URL/api/agent -H "authorization: Bearer mnem_…" \
 *        -H "content-type: application/json" -d '{"task":"what do I think about X?"}'
 */
import { NextResponse } from "next/server";
import { authorize, audit } from "@/lib/agent/rest";
import { runAgent } from "@/lib/agent/runtime";

export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = await authorize(req, "read");
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const task = String(b.task ?? b.q ?? b.text ?? b.query ?? "").trim();
  if (!task) {
    return NextResponse.json({ error: "Missing 'task'." }, { status: 400 });
  }

  let result;
  try {
    result = await runAgent(task, [], { mode: "chat", source: "siri" });
  } catch (e) {
    // Degrade gracefully so Siri speaks something useful instead of an error tone.
    const msg = (e as Error).message ?? "";
    const quota = /429|rate limit|free-models-per-day/i.test(msg);
    const spoken = quota
      ? "I've reached my free thinking limit for today. Try again later, or switch me to a local model so I never run out."
      : "Something went wrong while I was thinking. Please try again in a moment.";
    await audit(auth.keyId, "api_agent_error", { task, quota, error: msg.slice(0, 200) });
    return NextResponse.json({ answer: spoken, spoken, proposals: [], error: msg }, { status: 200 });
  }

  // A single string Siri can speak: the answer, plus a note if anything was queued.
  const spoken =
    result.proposals.length > 0
      ? `${result.answer} I've also queued ${result.proposals.length} suggestion${
          result.proposals.length === 1 ? "" : "s"
        } for you to approve in MNEMO.`
      : result.answer;

  await audit(auth.keyId, "api_agent", {
    task,
    proposals: result.proposals.length,
    runId: result.runId,
  });

  return NextResponse.json({
    answer: result.answer,
    spoken,
    proposals: result.proposals.map((p) => ({ summary: p.summary })),
    runId: result.runId,
  });
}
