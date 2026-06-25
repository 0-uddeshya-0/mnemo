"use client";
import { Link2 } from "lucide-react";
import type { SearchResult } from "@/lib/search";
import { NodeTypeBadge } from "@/components/node/node-type-badge";
import { cn } from "@/lib/utils";

export function ResultCard({
  result,
  onOpen,
  index,
}: {
  result: SearchResult;
  onOpen: (id: string) => void;
  index?: number;
}) {
  return (
    <button
      onClick={() => onOpen(result.id)}
      style={index !== undefined ? ({ "--i": index } as React.CSSProperties) : undefined}
      className={cn(
        "group flex w-full flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-border/70 hover:bg-surface-2/50",
        result.status === "superseded" && "opacity-50",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <NodeTypeBadge type={result.type} />
        <span
          className="size-2 shrink-0 rounded-full bg-primary"
          style={{ opacity: 0.25 + 0.75 * result.salience }}
          title={`salience ${result.salience.toFixed(2)}`}
        />
        <span className="truncate font-medium text-foreground group-hover:text-primary">
          {result.title}
        </span>
      </div>
      {result.summary && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{result.summary}</p>
      )}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {result.degree > 0 && (
          <span className="inline-flex items-center gap-1">
            <Link2 className="size-3" /> {result.degree} connection{result.degree === 1 ? "" : "s"}
          </span>
        )}
        {result.matchedVia === "both" && <span className="text-primary/70">keyword + semantic</span>}
      </div>
    </button>
  );
}
