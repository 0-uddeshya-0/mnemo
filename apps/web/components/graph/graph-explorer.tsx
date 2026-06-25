"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { Filter, Layers, Plus, Search, X } from "lucide-react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import {
  getGraphDataAction,
  quickAddNodeAction,
  type GraphData,
  type GraphFilters,
} from "@/app/(app)/actions/graph";
import type { GraphLink, GraphNode } from "@/lib/graph/read";
import {
  EDGE_TYPES,
  EDGE_TYPE_LABELS,
  NODE_TYPES,
  NODE_TYPE_COLORS,
  type EdgeType,
  type NodeType,
} from "@/lib/graph/constants";
import { openNode } from "@/components/node/node-drawer-store";
import { ThemesView } from "@/components/graph/themes-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

const ForceGraphCanvas = dynamic(() => import("@/components/graph/force-graph-canvas"), {
  ssr: false,
});

// muted Ocean-Fog-friendly cluster colors (calm, distinguishable)
const CLUSTER_PALETTE = [
  "#3E5A5D",
  "#5B7A9E",
  "#5A8A72",
  "#A87E4A",
  "#7E6BA0",
  "#A06A8A",
  "#4E8A8F",
  "#BE7B54",
  "#876FA6",
  "#6B7A82",
];

type FGNode = GraphNode & { x?: number; y?: number };

export function GraphExplorer() {
  const [data, setData] = React.useState<GraphData>({ nodes: [], links: [], clusters: [] });
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<"themes" | "graph">("themes");
  const [railOpen, setRailOpen] = React.useState(false);
  const [clusterLens, setClusterLens] = React.useState(false);
  const [hiddenTypes, setHiddenTypes] = React.useState<Set<NodeType>>(new Set());
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = React.useState<Set<EdgeType>>(new Set());
  const [minConfidence, setMinConfidence] = React.useState(0);
  const [includeSuperseded, setIncludeSuperseded] = React.useState(false);
  const [since, setSince] = React.useState<string>("all");
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [centerQuery, setCenterQuery] = React.useState("");
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [size, setSize] = React.useState({ w: 800, h: 600 });

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const methodsRef = React.useRef<ForceGraphMethods | undefined>(undefined);
  const focusRef = React.useRef<string | null>(null);
  const neighborsRef = React.useRef<Set<string>>(new Set());

  // cluster color map
  const clusterColor = React.useMemo(() => {
    const m = new Map<string, string>();
    data.clusters.forEach((c, i) => m.set(c.id, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]!));
    return m;
  }, [data.clusters]);

  // measure container
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // fetch graph data on filter change (debounced)
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    const filters: GraphFilters = {
      types: hiddenTypes.size ? NODE_TYPES.filter((t) => !hiddenTypes.has(t)) : undefined,
      edgeTypes: hiddenEdgeTypes.size ? EDGE_TYPES.filter((t) => !hiddenEdgeTypes.has(t)) : undefined,
      minConfidence,
      includeSuperseded,
      since: sinceToDate(since),
    };
    const t = setTimeout(async () => {
      try {
        const d = await getGraphDataAction(filters);
        if (active) setData(d);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [hiddenTypes, hiddenEdgeTypes, minConfidence, includeSuperseded, since]);

  // neighbor set for focus mode
  React.useEffect(() => {
    focusRef.current = focusId;
    const set = new Set<string>();
    if (focusId) {
      for (const l of data.links) {
        const s = typeof l.source === "string" ? l.source : (l.source as FGNode).id;
        const t = typeof l.target === "string" ? l.target : (l.target as FGNode).id;
        if (s === focusId) set.add(t);
        if (t === focusId) set.add(s);
      }
    }
    neighborsRef.current = set;
  }, [focusId, data.links]);

  const colorFor = React.useCallback(
    (node: FGNode) => {
      if (clusterLens) return node.clusterId ? clusterColor.get(node.clusterId) ?? "#64748b" : "#475569";
      return NODE_TYPE_COLORS[node.type] ?? "#94a3b8";
    },
    [clusterLens, clusterColor],
  );

  const drawNode = React.useCallback(
    (nodeUnknown: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const node = nodeUnknown as FGNode;
      if (node.x == null || node.y == null) return;
      const r = 2 + (node.salience ?? 0.3) * 6;
      const focus = focusRef.current;
      let alpha = 1;
      if (focus && focus !== node.id && !neighborsRef.current.has(node.id)) alpha = 0.18;
      if (node.status === "superseded") alpha *= 0.5;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = colorFor(node);
      ctx.fill();
      if (node.status === "superseded") {
        ctx.setLineDash([1.5, 1.5]);
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = colorFor(node);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const showLabel =
        scale > 1.6 || (node.salience ?? 0) > 0.62 || focus === node.id || neighborsRef.current.has(node.id);
      if (showLabel) {
        const label = node.title.length > 26 ? node.title.slice(0, 25) + "…" : node.title;
        ctx.font = `${11 / scale}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = `rgba(30,41,59,${alpha})`;
        ctx.fillText(label, node.x, node.y + r + 1.5 / scale);
      }
      ctx.globalAlpha = 1;
    },
    [colorFor],
  );

  const drawPointerArea = React.useCallback(
    (nodeUnknown: object, color: string, ctx: CanvasRenderingContext2D) => {
      const node = nodeUnknown as FGNode;
      if (node.x == null || node.y == null) return;
      const r = 2 + (node.salience ?? 0.3) * 6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 1.5, 0, 2 * Math.PI);
      ctx.fill();
    },
    [],
  );

  function centerOnNode(id: string) {
    const node = data.nodes.find((n) => n.id === id) as FGNode | undefined;
    if (node && node.x != null && node.y != null && methodsRef.current) {
      methodsRef.current.centerAt(node.x, node.y, 600);
      methodsRef.current.zoom(4, 600);
    }
    setFocusId(id);
  }

  const stats = `${data.nodes.length} nodes · ${data.links.length} links`;

  return (
    <div className="relative h-full w-full overflow-hidden" ref={wrapRef}>
      {/* View toggle: Themes (browsable cards) ⇄ Graph (force layout) */}
      <div className="liquid-glass absolute left-1/2 top-3 z-30 flex -translate-x-1/2 gap-0.5 rounded-full p-0.5">
        {(["themes", "graph"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "press rounded-full px-3.5 py-1 text-xs font-medium capitalize transition-colors",
              view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "themes" && (
        <div className="h-full pt-14">
          <ThemesView data={data} />
        </div>
      )}

      {/* Graph mode: toolbar, stats, filter rail, force canvas */}
      {view === "graph" && (
        <>
          <div className="absolute left-3 top-16 z-10 flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="secondary"
          onClick={() => setRailOpen((o) => !o)}
          aria-label="Toggle filters"
        >
          <Filter className="size-4" />
        </Button>
        <div className="flex items-center gap-2 rounded-lg border border-border glass px-2.5 py-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={centerQuery}
            onChange={(e) => setCenterQuery(e.target.value)}
            placeholder="Find a node…"
            className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            list="graph-node-list"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const match = data.nodes.find(
                  (n) => n.title.toLowerCase() === centerQuery.toLowerCase(),
                );
                if (match) centerOnNode(match.id);
              }
            }}
          />
          <datalist id="graph-node-list">
            {data.nodes.slice(0, 200).map((n) => (
              <option key={n.id} value={n.title} />
            ))}
          </datalist>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setQuickOpen(true)}>
          <Plus className="size-4" /> Node
        </Button>
        <Button
          size="sm"
          variant={clusterLens ? "default" : "secondary"}
          onClick={() => setClusterLens((c) => !c)}
        >
          <Layers className="size-4" /> Clusters
        </Button>
      </div>

      <div className="absolute right-3 top-3 z-10 glass rounded-lg px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        {loading ? "loading…" : stats}
      </div>

      {focusId && (
        <button
          onClick={() => setFocusId(null)}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 glass rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear focus
        </button>
      )}

      {/* Filter rail */}
      {railOpen && (
        <FilterRail
          hiddenTypes={hiddenTypes}
          setHiddenTypes={setHiddenTypes}
          hiddenEdgeTypes={hiddenEdgeTypes}
          setHiddenEdgeTypes={setHiddenEdgeTypes}
          minConfidence={minConfidence}
          setMinConfidence={setMinConfidence}
          includeSuperseded={includeSuperseded}
          setIncludeSuperseded={setIncludeSuperseded}
          since={since}
          setSince={setSince}
        />
      )}

      {/* Canvas */}
      {data.nodes.length === 0 && !loading ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Nothing to graph yet — capture something or start onboarding.
        </div>
      ) : (
        <ForceGraphCanvas
          width={size.w}
          height={size.h}
          graphData={data as unknown as { nodes: object[]; links: object[] }}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel={(n: object) => (n as FGNode).title}
          nodeVal={(n: object) => 1 + (n as FGNode).salience * 4}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={drawPointerArea}
          linkColor={(l: object) => {
            const link = l as GraphLink;
            const focus = focusRef.current;
            const s = typeof link.source === "string" ? link.source : (link.source as FGNode).id;
            const t = typeof link.target === "string" ? link.target : (link.target as FGNode).id;
            const dim = focus && focus !== s && focus !== t;
            return `rgba(71,85,105,${dim ? 0.07 : 0.18 + link.weight * 0.45})`;
          }}
          linkWidth={(l: object) => 0.4 + (l as GraphLink).weight * 1.6}
          linkDirectionalArrowLength={2.6}
          linkDirectionalArrowRelPos={1}
          linkLabel={(l: object) => {
            const link = l as GraphLink;
            const label = EDGE_TYPE_LABELS[link.type] ?? link.type;
            return link.rationale ? `${label}: ${link.rationale}` : label;
          }}
          onNodeClick={(n: object) => {
            const node = n as FGNode;
            setFocusId(node.id);
            openNode(node.id);
          }}
          onBackgroundClick={() => setFocusId(null)}
          onMethods={(m) => {
            methodsRef.current = m;
          }}
          cooldownTicks={120}
          warmupTicks={20}
          onEngineStop={() => methodsRef.current?.zoomToFit(400, 60)}
        />
      )}
        </>
      )}

      <QuickAddDialog open={quickOpen} onOpenChange={setQuickOpen} onAdded={(id) => openNode(id)} />
    </div>
  );
}

function FilterRail(props: {
  hiddenTypes: Set<NodeType>;
  setHiddenTypes: (s: Set<NodeType>) => void;
  hiddenEdgeTypes: Set<EdgeType>;
  setHiddenEdgeTypes: (s: Set<EdgeType>) => void;
  minConfidence: number;
  setMinConfidence: (n: number) => void;
  includeSuperseded: boolean;
  setIncludeSuperseded: (b: boolean) => void;
  since: string;
  setSince: (s: string) => void;
}) {
  const toggle = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  return (
    <div className="absolute left-3 top-28 z-10 flex max-h-[calc(100%-7rem)] w-60 flex-col overflow-y-auto glass rounded-xl p-3">
      <div className="mb-2 text-xs font-medium text-foreground">Node types</div>
      <div className="mb-3 flex flex-wrap gap-1">
        {NODE_TYPES.map((t) => {
          const hidden = props.hiddenTypes.has(t);
          return (
            <button
              key={t}
              onClick={() => toggle(props.hiddenTypes, t, props.setHiddenTypes)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-opacity",
                hidden ? "border-border opacity-40" : "border-border",
              )}
            >
              <span className="size-2 rounded-full" style={{ background: NODE_TYPE_COLORS[t] }} />
              {t.replace("_", " ")}
            </button>
          );
        })}
      </div>

      <Separator className="my-2" />
      <div className="mb-2 text-xs font-medium text-foreground">Edge types</div>
      <div className="mb-3 flex flex-wrap gap-1">
        {EDGE_TYPES.map((t) => {
          const hidden = props.hiddenEdgeTypes.has(t);
          return (
            <button
              key={t}
              onClick={() => toggle(props.hiddenEdgeTypes, t, props.setHiddenEdgeTypes)}
              className={cn(
                "rounded-md border border-border px-1.5 py-0.5 font-mono text-[9px] transition-opacity",
                hidden && "opacity-40",
              )}
            >
              {EDGE_TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>

      <Separator className="my-2" />
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">Min confidence</span>
        <span className="font-mono text-muted-foreground">{props.minConfidence.toFixed(2)}</span>
      </div>
      <Slider
        value={[props.minConfidence]}
        min={0}
        max={1}
        step={0.05}
        onValueChange={(v) => props.setMinConfidence(v[0] ?? 0)}
        className="mb-3"
      />

      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Show superseded</span>
        <Switch checked={props.includeSuperseded} onCheckedChange={props.setIncludeSuperseded} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">Since</span>
        <Select value={props.since} onValueChange={props.setSince}>
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function QuickAddDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (id: string) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<NodeType>("concept");
  const [pending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick-add node</DialogTitle>
        </DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
        <Select value={type} onValueChange={(v) => setType(v as NodeType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NODE_TYPES.filter((t) => t !== "self").map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button
            disabled={pending || !title.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await quickAddNodeAction({ title: title.trim(), type });
                if (res.ok) {
                  toast({ title: "Node added", variant: "success" });
                  setTitle("");
                  onOpenChange(false);
                  onAdded(res.id);
                } else toast({ title: "Failed", description: res.error, variant: "error" });
              })
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sinceToDate(since: string): string | null {
  if (since === "all") return null;
  const days = Number(since);
  return new Date(Date.now() - days * 86400_000).toISOString();
}
