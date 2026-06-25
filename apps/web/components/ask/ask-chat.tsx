"use client";
import * as React from "react";
import { MessageCircle, SendHorizonal } from "lucide-react";
import { askAction } from "@/app/(app)/ask/actions";
import type { Citation } from "@/lib/rag";
import { openNode } from "@/components/node/node-drawer-store";
import { NodeTypeBadge } from "@/components/node/node-type-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

export function AskChat({ initialQuery }: { initialQuery: string }) {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const sentInitial = React.useRef(false);

  const send = React.useCallback(
    async (question: string) => {
      if (!question.trim() || busy) return;
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((m) => [...m, { role: "user", content: question }]);
      setInput("");
      setBusy(true);
      try {
        const res = await askAction(question, history);
        setMessages((m) => [...m, { role: "assistant", content: res.answer, citations: res.citations }]);
      } catch {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Something glitched while I was thinking — try again?" },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages],
  );

  React.useEffect(() => {
    if (initialQuery && !sentInitial.current) {
      sentInitial.current = true;
      send(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-[680px] flex-col gap-5">
          {messages.length === 0 && !busy && (
            <div className="animate-fade-up flex flex-col items-center gap-3 pt-[12vh] text-center">
              <MessageCircle className="size-8 text-primary" />
              <h1 className="display-title text-2xl text-foreground">Ask your brain</h1>
              <p className="max-w-sm text-sm text-muted-foreground">
                Answers are grounded in your own knowledge — every claim cites the nodes it drew from.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className="animate-fade-up flex flex-col gap-2">
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  m.role === "user"
                    ? "self-end bg-primary/15 text-foreground"
                    : "self-start bg-surface text-foreground",
                )}
              >
                {m.content}
              </div>
              {m.citations && m.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 self-start pl-1">
                  {m.citations.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openNode(c.id)}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2/40 px-1.5 py-0.5 text-xs hover:bg-surface-2"
                    >
                      <NodeTypeBadge type={c.type} />
                      <span className="max-w-[160px] truncate">{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="animate-fade-up self-start rounded-2xl bg-surface px-4 py-2.5 text-sm text-muted-foreground">
              Searching your mind…
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-6 py-4">
        <div className="mx-auto flex max-w-[680px] items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask anything about what you know, believe, or have read…"
            disabled={busy}
            className="min-h-[48px] resize-none"
          />
          <Button onClick={() => send(input)} disabled={busy || !input.trim()} size="icon" className="size-12 shrink-0">
            <SendHorizonal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
