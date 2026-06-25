"use client";
import * as React from "react";
import { Mic, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Tap-to-talk, transcribed PRIVATELY on your Mac (whisper.cpp) — the recorded audio is sent
 * only to MNEMO's own /transcribe endpoint and never to a cloud speech service. Works wherever
 * the browser can record (desktop + iOS Safari over your tailnet).
 */
type State = "idle" | "recording" | "transcribing";

export function MicButton({
  onTranscript,
  disabled,
  size = 12,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  size?: number;
}) {
  const [state, setState] = React.useState<State>("idle");
  const [supported, setSupported] = React.useState(true);
  const recRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const cbRef = React.useRef(onTranscript);
  cbRef.current = onTranscript;

  React.useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined";
    setSupported(ok);
    return () => stopStream();
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (!blob.size) return setState("idle");
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob, "audio.webm");
          const res = await fetch("/api/internal/transcribe", { method: "POST", body: fd });
          const data = (await res.json().catch(() => ({}))) as { text?: string };
          if (data.text?.trim()) cbRef.current(data.text.trim());
        } catch {
          /* network/transcription failure is non-fatal */
        }
        setState("idle");
      };
      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch {
      setState("idle");
      setSupported(false); // mic permission denied / unavailable
    }
  }

  function toggle() {
    if (state === "recording") {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    } else if (state === "idle") {
      void start();
    }
  }

  if (!supported) return null;
  const busy = state === "transcribing";

  return (
    <Button
      type="button"
      size="icon"
      variant={state === "recording" ? "default" : "secondary"}
      disabled={disabled || busy}
      onClick={toggle}
      aria-label={state === "recording" ? "Stop and transcribe" : "Speak"}
      title="Speak to MNEMO — transcribed privately on your Mac"
      className={cn("shrink-0", state === "recording" && "animate-pulse")}
      style={{ width: `${size * 0.25}rem`, height: `${size * 0.25}rem` }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
    </Button>
  );
}
