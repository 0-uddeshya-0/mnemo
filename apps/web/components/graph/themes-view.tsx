"use client";
import * as React from "react";
import type { GraphData } from "@/app/(app)/actions/graph";
import type { GraphNode } from "@/lib/graph/read";
import { NODE_TYPE_COLORS, type NodeType } from "@/lib/graph/constants";
import { openNode } from "@/components/node/node-drawer-store";

interface Group {
  key: string;
  label: string;
  nodes: GraphNode[];
}

/**
 * An alternative to the force-graph: your mind as a set of browsable theme-cards. Groups
 * nodes by their synthesis cluster when available, otherwise by type. Calm, scrollable,
 * thumb-friendly — tap any node to open it.
 */
export function ThemesView({ data }: { data: GraphData }) {
  const groups = React.useMemo<Group[]>(() => {
    const clusterLabel = new Map(data.clusters.map((c) => [c.id, c.label]));
    const buckets = new Map<string, Group>();
    for (const n of data.nodes) {
      const key = n.clusterId && clusterLabel.has(n.clusterId) ? `c:${n.clusterId}` : `t:${n.type}`;
      const label = key.startsWith("c:") ? clusterLabel.get(n.clusterId!)! : prettyType(n.type);
      if (!buckets.has(key)) buckets.set(key, { key, label, nodes: [] });
      buckets.get(key)!.nodes.push(n);
    }
    return [...buckets.values()]
      .map((g) => ({ ...g, nodes: g.nodes.sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0)) }))
      .sort((a, b) => b.nodes.length - a.nodes.length);
  }, [data]);

  if (data.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Nothing to show yet — capture something or finish onboarding, and your themes will form here.
      </div>
    );
  }

  return (
    <div className="scroll-touch h-full overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {groups.map((g) => (
          <section key={g.key} className="surface p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-foreground">{g.label}</h3>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{g.nodes.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.nodes.slice(0, 60).map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNode(n.id)}
                  className="press inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-2/40 px-2.5 py-1 text-xs text-foreground hover:bg-surface-2"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: NODE_TYPE_COLORS[n.type] ?? "#94a3b8" }}
                  />
                  <span className="truncate">{n.title}</span>
                </button>
              ))}
              {g.nodes.length > 60 && (
                <span className="self-center px-1 text-xs text-muted-foreground">+{g.nodes.length - 60} more</span>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function prettyType(t: NodeType): string {
  const s = t.replace("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1) + "s";
}
