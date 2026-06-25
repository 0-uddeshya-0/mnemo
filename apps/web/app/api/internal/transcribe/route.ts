/** Owner-session speech-to-text. Audio is transcribed locally (whisper.cpp) and never leaves
 * the Mac — unlike the browser's Web Speech API, which streams audio to a cloud service. */
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { transcribeAudio, whisperReady } from "@/lib/transcribe";

export const maxDuration = 60;

export async function GET() {
  // Lets the client decide whether to show the local mic (vs. fall back gracefully).
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ready: await whisperReady() });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return NextResponse.json({ error: "No audio." }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Audio too large." }, { status: 413 });

  const ext = (file.type.split("/")[1] || "webm").split(";")[0];
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const text = await transcribeAudio(buf, ext);
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
