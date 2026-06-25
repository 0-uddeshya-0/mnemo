"use client";
// cmd+k overlay — live hybrid search anywhere. Arrow keys to navigate, ↵ to open a node.
import * as React from "react";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { searchAction } from "@/app/(app)/actions/search";
import type { SearchResult } from "@/lib/search";
import { closePalette, subscribePalette } from "@/components/command/palette-store";
import { openNode } from "@/components/node/node-drawer-store";
import { NodeTypeBadge } from "@/components/node/node-type-badge";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => subscribePalette(setOpen), []);
  React.useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      setActive(0);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let on = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchAction(q, { limit: 8 });
        if (on) {
          setResults(r);
          setActive(0);
        }
      } finally {
        if (on) setLoading(false);
      }
    }, 150);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [q, open]);

  function choose(r: SearchResult | undefined) {
    if (!r) return;
    closePalette();
    openNode(r.id);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closePalette()}>
      <DialogContent hideClose className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search your mind</DialogTitle>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search your mind…"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {q.trim() ? "No matches." : "Start typing to search."}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left",
                  i === active ? "bg-surface-2" : "hover:bg-surface-2/60",
                )}
              >
                <NodeTypeBadge type={r.type} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.title}</span>
                {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
