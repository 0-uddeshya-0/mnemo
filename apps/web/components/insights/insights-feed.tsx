"use client";
import * as React from "react";
import {
  AlertTriangle,
  GitBranch,
  Layers,
  Moon,
  Puzzle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  confirmEvolutionAction,
  dismissInsightAction,
  getInsightsAction,
  runSynthesisAction,
  type InsightView,
} from "@/app/(app)/insights/actions";
import type { InsightKind } from "@/lib/graph/constants";
import { openNode } from "@/components/node/node-drawer-store";
import { NodeTypeBadge } from "@/components/node/node-type-badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { timeAgo } from "@/lib/utils";

const KIND_META: Record<InsightKind, { icon: LucideIcon; color: string; label: string }> = {
  contradiction: { icon: AlertTriangle, color: "#f87171", label: "Tension" },
  gap: { icon: Puzzle, color: "#60a5fa", label: "Gap" },
  cluster: { icon: Layers, color: "#a78bfa", label: "Theme" },
  dormant: { icon: Moon, color: "#94a3b8", label: "Dormant" },
  evolution: { icon: GitBranch, color: "#fb923c", label: "Evolution" },
};

export function InsightsFeed({ initial }: { initial: InsightView[] }) {
  const [items, setItems] = React.useState<InsightView[]>(initial);
  const [refreshing, setRefreshing] = React.useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const summary = await runSynthesisAction();
      const next = await getInsightsAction();
      setItems(next);
      toast({
        title: "Synthesis complete",
        description: `${summary.clusters} themes · ${summary.contradictions} tensions · ${summary.gaps} gaps · ${summary.dormant} dormant`,
        variant: "success",
      });
    } catch (e) {
      toast({ title: "Synthesis failed", description: (e as Error).message, variant: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  async function dismiss(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await dismissInsightAction(id);
  }

  async function confirmEvolution(item: InsightView) {
    const newId = String(item.detail.newNodeId ?? "");
    const oldId = String(item.detail.oldNodeId ?? "");
    if (!newId || !oldId) return;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await confirmEvolutionAction(newId, oldId, item.id);
    toast({ title: "Supersession confirmed", description: "Old view archived to history.", variant: "success" });
  }

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="display-title text-3xl text-foreground">Insights</h1>
          <p className="text-sm text-muted-foreground">What your brain noticed about itself.</p>
        </div>
        <Button onClick={refresh} disabled={refreshing} variant="secondary">
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          {refreshing ? "Thinking…" : "Run synthesis"}
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-12 text-center">
          <Sparkles className="size-7 text-primary" />
          <p className="text-foreground">No insights yet.</p>
          <p className="text-sm text-muted-foreground">
            Capture a few things, then run synthesis to surface themes, tensions, and gaps.
          </p>
        </div>
      ) : (
        <div className="stagger flex flex-col gap-3">
          {items.map((item, i) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            return (
              <div
                key={item.id}
                style={{ "--i": i } as React.CSSProperties}
                className="animate-fade-up rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${meta.color}1a`, color: meta.color }}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-[10px] uppercase tracking-wide"
                        style={{ color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-foreground">{item.title}</p>
                    {typeof item.detail.message === "string" && (
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail.message}</p>
                    )}
                    {typeof item.detail.summary === "string" && (
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail.summary}</p>
                    )}
                    {typeof item.detail.why === "string" && (
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail.why}</p>
                    )}

                    {item.nodes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.nodes.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => openNode(n.id)}
                            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2/50 px-1.5 py-0.5 text-xs hover:bg-surface-2"
                          >
                            <NodeTypeBadge type={n.type} />
                            <span className="max-w-[180px] truncate">{n.title}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      {item.kind === "evolution" && (
                        <Button size="sm" onClick={() => confirmEvolution(item)}>
                          Confirm supersession
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                  <button
                    onClick={() => dismiss(item.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
