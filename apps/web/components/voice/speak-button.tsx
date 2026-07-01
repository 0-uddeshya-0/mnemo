"use client";
import * as React from "react";
import { Volume2, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Read an answer aloud, fully on-device via the browser Speech Synthesis API — free, offline,
 * no backend, works everywhere (incl. iOS Safari). Completes the voice loop (whisper in, TTS out).
 */
export function SpeakButton({ text, className }: { text: string; className?: string }) {
  const [speaking, setSpeaking] = React.useState(false);
  const [supported, setSupported] = React.useState(true);

  React.useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  function toggle() {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth) return;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.03;
    const en = synth.getVoices().find((v) => /^en[-_]/i.test(v.lang));
    if (en) u.voice = en; // keep it English to match the app; else the OS default
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      aria-label={speaking ? "Stop reading" : "Read aloud"}
      title={speaking ? "Stop" : "Read aloud"}
    >
      {speaking ? <Square className="size-3" /> : <Volume2 className="size-3.5" />}
      {speaking ? "Stop" : "Read aloud"}
    </button>
  );
}
