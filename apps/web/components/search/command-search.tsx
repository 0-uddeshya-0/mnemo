"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Sparkles, MessageCircle, Loader2 } from "lucide-react";
import { searchAction } from "@/app/(app)/actions/search";
import { offlineSearch } from "@/lib/offline/store";
import type { SearchResult } from "@/lib/search";
import { openNode } from "@/components/node/node-drawer-store";
import { ResultCard } from "@/components/search/result-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "search" | "ask";

export function CommandSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = React.useState(initialQuery);
  const [mode, setMode] = React.useState<Mode>("search");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [touched, setTouched] = React.useState(Boolean(initialQuery));

  React.useEffect(() => {
    if (mode !== "search") return;
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchAction(q, { limit: 30 });
        if (active) setResults(r);
      } catch {
        // Offline (or server unreachable) → search the cached on-device graph (hybrid:
        // keyword + in-browser semantic when the MiniLM model has been warmed).
        const offline = await offlineSearch(q, 30, { semantic: true });
        if (active)
          setResults(
            offline.map((o) => ({
              id: o.id,
              title: o.title,
              type: o.type,
              summary: o.summary,
              confidence: 1,
              salience: o.salience,
              status: o.status,
              sensitivity: "normal",
              degree: o.degree,
              score: o.salience,
              matchedVia: "keyword" as const,
            })),
          );
      } finally {
        if (active) setLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, mode]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "ask") {
      router.push(q.trim() ? `/ask?q=${encodeURIComponent(q.trim())}` : "/ask");
      return;
    }
    const first = results[0];
    if (first) openNode(first.id);
  }

  const grouped = groupByType(results);
  const empty = !loading && touched && results.length === 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 pt-[10vh]">
      <form onSubmit={onSubmit} className="animate-fade-up">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] focus-within:ring-2 focus-within:ring-ring">
          {loading ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="size-5 shrink-0 text-muted-foreground" />
          )}
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setTouched(true);
            }}
            placeholder={mode === "ask" ? "Ask your brain anything…" : "Search your mind…"}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-lg"
          />
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5">
            <ModeToggle mode={mode} value="search" setMode={setMode} icon={Search} label="Search" />
            <ModeToggle mode={mode} value="ask" setMode={setMode} icon={MessageCircle} label="Ask" />
          </div>
        </div>
      </form>

      <div className="mt-6 flex-1 overflow-y-auto pb-10">
        {mode === "ask" ? (
          <div className="animate-fade-up rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
            Press <span className="font-mono">↵</span> to ask your brain — answers cite the nodes
            they draw from.
          </div>
        ) : empty ? (
          <EmptyState query={q} />
        ) : (
          <div className="flex flex-col gap-6">
            {Object.entries(grouped).map(([type, rs]) => (
              <section key={type}>
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {type.replace("_", " ")} · {rs.length}
                </h3>
                <div className="stagger grid grid-cols-1 gap-2">
                  {rs.map((r, i) => (
                    <ResultCard key={r.id} result={r} index={i} onOpen={openNode} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  value,
  setMode,
  icon: Icon,
  label,
}: {
  mode: Mode;
  value: Mode;
  setMode: (m: Mode) => void;
  icon: typeof Search;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        mode === value ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function EmptyState({ query }: { query: string }) {
  if (query.trim()) {
    return (
      <div className="animate-fade-up rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing in your mind matches “{query}” yet.
        </p>
      </div>
    );
  }
  return (
    <div className="animate-fade-up flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-10 text-center">
      <Sparkles className="size-7 text-primary" />
      <div>
        <p className="text-foreground">Your mind is mostly empty here.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell Mnemosyne who you are, or feed it something you've read.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/onboarding">Start onboarding</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/capture">Capture something</Link>
        </Button>
      </div>
    </div>
  );
}

function groupByType(results: SearchResult[]): Record<string, SearchResult[]> {
  const groups: Record<string, SearchResult[]> = {};
  for (const r of results) (groups[r.type] ??= []).push(r);
  return groups;
}
