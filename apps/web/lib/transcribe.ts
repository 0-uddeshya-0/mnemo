/**
 * Local speech-to-text — MNEMO's ears, fully on-device. Browser audio (webm/opus) is
 * converted to 16 kHz mono WAV with ffmpeg, then transcribed by whisper.cpp. Nothing is ever
 * sent to a cloud speech service (unlike the browser's Web Speech API). Best-effort, bounded.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { env } from "@/lib/env";

function modelPath(): string {
  return env.WHISPER_MODEL || resolve(process.cwd(), "../../models/whisper/ggml-base.en.bin");
}

export async function whisperReady(): Promise<boolean> {
  try {
    await access(modelPath());
    await access(env.WHISPER_BIN);
    return true;
  } catch {
    return false;
  }
}

/** Transcribe an audio buffer (any ffmpeg-readable container) to text, on-device. */
export async function transcribeAudio(buf: Buffer, ext = "webm"): Promise<string> {
  const model = modelPath();
  if (!(await whisperReady())) {
    throw new Error("local speech-to-text is not set up (missing whisper model or binary)");
  }
  const dir = await mkdtemp(join(tmpdir(), "mnemo-stt-"));
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "webm";
  const inFile = join(dir, `in.${safeExt}`);
  const wav = join(dir, "audio.wav");
  const outPrefix = join(dir, "out");
  try {
    await writeFile(inFile, buf);
    // Normalize to what whisper.cpp expects: 16 kHz, mono, 16-bit PCM.
    await run(env.FFMPEG_BIN, ["-i", inFile, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav, "-y"]);
    // -np: no progress spam; -nt: no timestamps; -otxt: write <prefix>.txt.
    await run(env.WHISPER_BIN, ["-m", model, "-f", wav, "-l", "en", "-np", "-nt", "-otxt", "-of", outPrefix]);
    const text = await readFile(`${outPrefix}.txt`, "utf8").catch(() => "");
    return text.replace(/\s+/g, " ").trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stderr.on("data", (d) => {
      err += d.toString();
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-300)}`));
    });
  });
}
