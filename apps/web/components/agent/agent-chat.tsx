"use client";
import * as React from "react";
import { Bot, Check, ChevronDown, Globe, Microscope, Moon, SendHorizonal, Sparkles, Wrench, X } from "lucide-react";
import {
  dismissRunAction,
  executeProposalsAction,
  listInboxAction,
  rebuildPersonaAction,
  runAgentAction,
  startDeepResearchAction,
  type AgentResult,
  type ProposedAction,
  type RunRecord,
} from "@/app/(app)/agent/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { Logo } from "@/components/shell/logo";
import { MicButton } from "@/components/voice/mic-button";
import { SpeakButton } from "@/components/voice/speak-button";
import { cn } from "@/lib/utils";

interface Turn {
  role: "user" | "mnemo";
  content: string;
  result?: AgentResult;
  done?: boolean;
}

const SUGGESTIONS = [
  "Organize anything new in my brain and propose links",
  "What should I focus on, given everything I believe?",
  "Research a topic on the web and relate it to what I already know",
];

// Warm, a little funny, a little smug — MNEMO is you, minus the forgetting.
const QUIPS = [
  "I'm you, with perfect memory and zero ego. What are we getting into?",
  "I've read everything you've ever told me — so go on, make me useful.",
  "Your second mind: all of the knowing, none of the 3 a.m. overthinking.",
  "I keep the receipts so you don't have to. Ask me anything.",
  "Same brain as yours, just better at finding things. Where do we start?",
  "I remember what you forgot you knew. Want me to connect some dots?",
];

export function AgentChat({ ownerName }: { ownerName: string }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [inbox, setInbox] = React.useState<RunRecord[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const greeting = React.useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);
  // Pick after mount so SSR + first client paint match (no hydration mismatch).
  const [quip, setQuip] = React.useState(QUIPS[0]);
  React.useEffect(() => setQuip(QUIPS[Math.floor(Math.random() * QUIPS.length)]), []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  React.useEffect(() => {
    listInboxAction().then(setInbox).catch(() => {});
  }, []);

  function clearInbox(runId: string) {
    setInbox((items) => items.filter((r) => r.id !== runId));
  }

  async function send(task: string) {
    if (!task.trim() || busy) return;
    const history = turns.map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), content: t.content }));
    setTurns((t) => [...t, { role: "user", content: task }]);
    setInput("");
    setBusy(true);
    try {
      const result = await runAgentAction(task, history);
      setTurns((t) => [...t, { role: "mnemo", content: result.answer, result }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "mnemo", content: `Something broke while I was thinking: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function deepResearch() {
    const topic = input.trim();
    if (topic.length < 3 || busy) return;
    setInput("");
    const res = await startDeepResearchAction(topic);
    if (res.ok) {
      toast({
        title: "Researching in the background",
        description: "It's slow on-device — I'll leave the brief in your inbox here when it's done.",
        variant: "success",
      });
    } else {
      toast({ title: res.error ?? "Couldn't start research", variant: "error" });
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-2.5">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="text-sm font-medium">MNEMO — your agent</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            toast({ title: "Updating my model of you…" });
            await rebuildPersonaAction();
            toast({ title: "Persona refreshed", variant: "success" });
          }}
        >
          <Sparkles className="size-4" /> Refresh persona
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5">
          {inbox.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Moon className="size-3.5 text-primary" />
                While you were away — {inbox.length} digest{inbox.length === 1 ? "" : "s"} to review
              </div>
              {inbox.map((run) => (
                <InboxCard key={run.id} run={run} onResolved={() => clearInbox(run.id)} />
              ))}
            </div>
          )}

          {turns.length === 0 && !busy && (
            <div className="animate-fade-up flex flex-col items-center gap-4 pt-[8vh] text-center">
              <Logo size={76} className="shadow-[0_10px_30px_-10px_rgba(12,143,126,0.5)]" />
              <h1 className="display-title text-[1.7rem] text-foreground">{greeting}, {ownerName}.</h1>
              <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">{quip}</p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, i) => (
            <div key={i} className="animate-fade-up flex flex-col gap-2">
              {turn.role === "user" ? (
                <div className="self-end rounded-2xl bg-primary/15 px-4 py-2.5 text-sm text-foreground">
                  {turn.content}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {turn.result && turn.result.steps.length > 0 && <Reasoning result={turn.result} />}
                  <div className="self-start whitespace-pre-wrap rounded-2xl bg-surface px-4 py-2.5 text-sm leading-relaxed text-foreground">
                    {turn.content}
                  </div>
                  <SpeakButton text={turn.content} className="self-start px-1" />
                  {turn.result && turn.result.proposals.length > 0 && (
                    <Proposals turn={turn} onDone={() => setTurns((ts) => ts.map((t, j) => (j === i ? { ...t, done: true } : t)))} />
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="animate-fade-up flex items-center gap-2 self-start rounded-2xl bg-surface px-4 py-2.5 text-sm text-muted-foreground">
              <Bot className="size-4 animate-pulse text-primary" /> thinking, searching, reasoning…
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[760px] items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask MNEMO, or tap the mic to talk…"
            disabled={busy}
            className="min-h-[48px] resize-none"
          />
          <MicButton onTranscript={setInput} disabled={busy} />
          <Button
            onClick={deepResearch}
            disabled={busy || input.trim().length < 3}
            size="icon"
            variant="secondary"
            className="size-12 shrink-0"
            title="Deep research (runs in the background → your inbox)"
            aria-label="Deep research"
          >
            <Microscope className="size-4" />
          </Button>
          <Button onClick={() => send(input)} disabled={busy || !input.trim()} size="icon" className="size-12 shrink-0">
            <SendHorizonal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Reasoning({ result }: { result: AgentResult }) {
  const [open, setOpen] = React.useState(false);
  const toolSteps = result.steps.filter((s) => s.tool);
  if (toolSteps.length === 0) return null;
  return (
    <div className="self-start">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {toolSteps.length} step{toolSteps.length === 1 ? "" : "s"} of reasoning
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 border-l border-border pl-3">
          {result.steps.map((s, i) => (
            <div key={i} className="text-xs">
              {s.thought && <p className="text-muted-foreground">{s.thought}</p>}
              {s.tool && (
                <p className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-foreground">
                  {s.tool.startsWith("web") ? <Globe className="size-3" /> : <Wrench className="size-3" />}
                  {s.tool}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Proposals({ turn, onDone }: { turn: Turn; onDone: () => void }) {
  const proposals = turn.result?.proposals ?? [];
  const [selected, setSelected] = React.useState<Set<string>>(new Set(proposals.map((p) => p.id)));
  const [pending, startTransition] = React.useTransition();

  if (turn.done) {
    return (
      <div className="self-start rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
        <Check className="mr-1 inline size-3.5" /> Done — applied to your brain.
      </div>
    );
  }

  return (
    <div className="self-start w-full max-w-[85%] rounded-xl border border-border bg-surface p-3">
      <p className="mb-2 text-xs font-medium text-foreground">
        MNEMO wants to do {proposals.length} thing{proposals.length === 1 ? "" : "s"} — approve?
      </p>
      <div className="flex flex-col gap-1.5">
        {proposals.map((p: ProposedAction) => (
          <label key={p.id} className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                  return n;
                })
              }
              className="mt-0.5"
            />
            <span className="font-mono text-[11px] text-muted-foreground">{p.summary}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          disabled={pending || selected.size === 0}
          onClick={() =>
            startTransition(async () => {
              const approved = proposals.filter((p) => selected.has(p.id));
              const res = await executeProposalsAction(approved, turn.result?.runId);
              toast({ title: `Applied ${res.executed} action${res.executed === 1 ? "" : "s"}`, variant: "success" });
              onDone();
            })
          }
        >
          <Check className="size-4" /> Approve {selected.size}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Skip
        </Button>
      </div>
    </div>
  );
}

/** A digest MNEMO left while you were away: its note + the actions it proposes. */
function InboxCard({ run, onResolved }: { run: RunRecord; onResolved: () => void }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(run.proposals.map((p) => p.id)));
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="animate-fade-up rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
      <p className="mb-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{run.answer}</p>
      <SpeakButton text={run.answer} className="mb-3" />
      {run.proposals.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="mb-2 text-xs font-medium text-foreground">
            {run.proposals.length} suggestion{run.proposals.length === 1 ? "" : "s"} — approve what you like
          </p>
          <div className="flex flex-col gap-1.5">
            {run.proposals.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                      return n;
                    })
                  }
                  className="mt-0.5"
                />
                <span className="font-mono text-[11px] text-muted-foreground">{p.summary}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {run.proposals.length > 0 && (
          <Button
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() =>
              startTransition(async () => {
                const approved = run.proposals.filter((p) => selected.has(p.id));
                const res = await executeProposalsAction(approved, run.id);
                toast({ title: `Applied ${res.executed} action${res.executed === 1 ? "" : "s"}`, variant: "success" });
                onResolved();
              })
            }
          >
            <Check className="size-4" /> Approve {selected.size}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await dismissRunAction(run.id);
              onResolved();
            })
          }
        >
          <X className="size-4" /> Dismiss
        </Button>
      </div>
    </div>
  );
}
