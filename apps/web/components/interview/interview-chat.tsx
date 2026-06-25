"use client";
import * as React from "react";
import { SendHorizonal, SkipForward, Sparkles } from "lucide-react";
import {
  answerInterviewAction,
  skipQuestionAction,
  startInterviewAction,
} from "@/app/(app)/onboarding/actions";
import type { CapturedAtom, NextQuestion } from "@/lib/interview";
import { INTERVIEW_PHASES, NODE_TYPE_COLORS, type InterviewPhase } from "@/lib/graph/constants";
import { openNode } from "@/components/node/node-drawer-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Message {
  role: "assistant" | "user";
  text: string;
}

export function InterviewChat() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [current, setCurrent] = React.useState<NextQuestion | null>(null);
  const [completeness, setCompleteness] = React.useState(0);
  const [atoms, setAtoms] = React.useState<CapturedAtom[]>([]);
  const [input, setInput] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [started, setStarted] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const isMCQ = current?.kind === "single" || current?.kind === "multi";

  // reset inputs whenever the question changes
  React.useEffect(() => {
    setSelected(new Set());
    setInput("");
  }, [current?.question]);

  function toggleOption(opt: string) {
    setSelected((prev) => {
      if (current?.kind === "single") return new Set([opt]);
      const next = new Set(prev);
      next.has(opt) ? next.delete(opt) : next.add(opt);
      return next;
    });
  }

  React.useEffect(() => {
    (async () => {
      const res = await startInterviewAction();
      const msgs: Message[] = [];
      if (res.coldStart) msgs.push({ role: "assistant", text: res.coldStart });
      msgs.push({ role: "assistant", text: res.next.question });
      setMessages(msgs);
      setCurrent(res.next);
      setCompleteness(res.completeness);
      setStarted(true);
    })();
  }, []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function submit() {
    if (!current || busy) return;
    const answer = isMCQ ? [...selected].join(", ") : input.trim();
    if (!answer) return;
    setInput("");
    setSelected(new Set());
    setMessages((m) => [...m, { role: "user", text: answer }]);
    setBusy(true);
    try {
      const res = await answerInterviewAction(current.phase, current.question, answer);
      setAtoms((a) => [...res.atoms, ...a]);
      setCompleteness(res.completeness);
      setMessages((m) => [...m, { role: "assistant", text: res.next.question }]);
      setCurrent(res.next);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Something glitched on my end — try saying that again?" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!current || busy) return;
    setBusy(true);
    try {
      const next = await skipQuestionAction(current.phase, current.question);
      setMessages((m) => [...m, { role: "assistant", text: next.question }]);
      setCurrent(next);
    } finally {
      setBusy(false);
    }
  }

  const currentPhaseIdx = current ? INTERVIEW_PHASES.indexOf(current.phase) : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Phase progress bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-2.5">
        <div className="flex flex-1 items-center gap-1">
          {INTERVIEW_PHASES.map((p, i) => (
            <div
              key={p}
              title={p.replace("_", " ")}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < currentPhaseIdx
                  ? "bg-primary"
                  : i === currentPhaseIdx
                    ? "bg-primary/60"
                    : "bg-surface-2",
              )}
            />
          ))}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {completeness}% known
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto flex max-w-[680px] flex-col gap-4">
              {!started && <p className="text-sm text-muted-foreground">Warming up…</p>}
              {current && (
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {current.drip ? "ongoing" : current.phase.replace("_", " ")}
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "animate-fade-up max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    m.role === "assistant"
                      ? "self-start bg-surface text-foreground"
                      : "self-end bg-primary/15 text-foreground",
                  )}
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <div className="animate-fade-up self-start rounded-2xl bg-surface px-4 py-2.5 text-sm text-muted-foreground">
                  <span className="inline-flex gap-1">
                    <Dot /> <Dot /> <Dot />
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-border px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-[680px]">
              {current?.note && (
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {current.note}
                </p>
              )}

              {isMCQ && current?.options ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {current.options.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => toggleOption(opt)}
                        disabled={busy}
                        className={cn(
                          "press rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                          selected.has(opt)
                            ? "border-primary bg-primary/15 text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={skip}
                      disabled={busy}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <SkipForward className="size-3" /> Skip
                    </button>
                    <Button onClick={submit} disabled={busy || selected.size === 0}>
                      {current.kind === "multi" ? `Continue${selected.size ? ` · ${selected.size}` : ""}` : "Continue"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submit();
                        }
                      }}
                      placeholder={busy ? "Thinking…" : "Type your answer…  (⏎ to send)"}
                      disabled={busy || !started}
                      className="min-h-[48px] resize-none"
                    />
                    <Button onClick={submit} disabled={busy || !input.trim()} size="icon" className="size-12 shrink-0">
                      <SendHorizonal className="size-4" />
                    </Button>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span>Skip anything you'd rather not answer.</span>
                    <button onClick={skip} disabled={busy} className="inline-flex items-center gap-1 hover:text-foreground">
                      <SkipForward className="size-3" /> Ask me something else
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right rail: captured atoms */}
        <aside className="hidden w-64 shrink-0 flex-col border-l border-border lg:flex">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-medium">Your brain, forming</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {atoms.length === 0 ? (
              <p className="px-1 py-4 text-xs text-muted-foreground">
                As you answer, the atoms I capture appear here.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {atoms.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => openNode(a.id)}
                    className="animate-fade-up flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-xs hover:bg-surface-2"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: NODE_TYPE_COLORS[a.type] }}
                    />
                    <span className="min-w-0">
                      <span className="text-muted-foreground">{a.type}:</span>{" "}
                      <span className="text-foreground">{a.title}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="inline-block size-1.5 animate-pulse rounded-full bg-muted-foreground" />;
}
