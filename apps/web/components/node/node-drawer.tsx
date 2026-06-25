"use client";
import * as React from "react";
import Link from "next/link";
import {
  Check,
  History,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { NodeTypeBadge } from "@/components/node/node-type-badge";
import { closeNode, openNode, subscribeNode } from "@/components/node/node-drawer-store";
import {
  addConnectionAction,
  deleteNodeAction,
  getNodeDetailAction,
  relinkNodeAction,
  removeConnectionAction,
  searchPickerAction,
  updateNodeAction,
  type NodeDetail,
} from "@/app/(app)/actions/nodes";
import { EDGE_TYPE_LABELS, EDGE_TYPES, SENSITIVITIES, type EdgeType, type NodeType } from "@/lib/graph/constants";
import { timeAgo } from "@/lib/utils";

export function NodeDrawer() {
  const [nodeId, setNodeId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<NodeDetail | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => subscribeNode(setNodeId), []);

  const reload = React.useCallback(async (id: string) => {
    setLoading(true);
    try {
      setDetail(await getNodeDetailAction(id));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (nodeId) reload(nodeId);
    else setDetail(null);
  }, [nodeId, reload]);

  return (
    <Sheet open={nodeId !== null} onOpenChange={(o) => !o && closeNode()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {loading && !detail ? (
          <div className="flex flex-col gap-3 p-6">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : detail ? (
          <DrawerBody detail={detail} onChanged={() => nodeId && reload(nodeId)} />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Node not found.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ detail, onChanged }: { detail: NodeDetail; onChanged: () => void }) {
  const { node } = detail;
  const [title, setTitle] = React.useState(node.title);
  const [summary, setSummary] = React.useState(node.summary ?? "");
  const [body, setBody] = React.useState(detail.bodyPlain ?? "");
  const [sensitivity, setSensitivity] = React.useState(node.sensitivity);
  const [saving, setSaving] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setTitle(node.title);
    setSummary(node.summary ?? "");
    setBody(detail.bodyPlain ?? "");
    setSensitivity(node.sensitivity);
  }, [node.id, node.title, node.summary, node.sensitivity, detail.bodyPlain]);

  const dirty =
    title !== node.title ||
    summary !== (node.summary ?? "") ||
    body !== (detail.bodyPlain ?? "") ||
    sensitivity !== node.sensitivity;

  async function save() {
    setSaving(true);
    const res = await updateNodeAction(node.id, {
      title,
      summary: summary || null,
      body: body || null,
      sensitivity,
    });
    setSaving(false);
    if (res.ok) {
      toast({ title: "Saved", variant: "success" });
      onChanged();
    } else {
      toast({ title: "Save failed", description: res.error, variant: "error" });
    }
  }

  const grouped = groupConnections(detail.connections);

  return (
    <>
      {/* Header */}
      <SheetHeader className="border-b border-border p-5 pr-12">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <NodeTypeBadge type={node.type} />
          <Badge variant="mono">conf {node.confidence.toFixed(2)}</Badge>
          <Badge variant="mono">sal {node.salience.toFixed(2)}</Badge>
          {node.status !== "active" && <Badge variant="secondary">{node.status}</Badge>}
          {detail.source && (
            <button
              onClick={() => detail.source && openNode(detail.source.id)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              ↳ from {detail.source.title}
            </button>
          )}
        </div>
        <SheetTitle asChild>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-auto border-0 bg-transparent px-0 text-lg font-medium shadow-none focus-visible:ring-0"
          />
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-5">
          {/* Photo (if this memory is a photo) */}
          <PhotoBlock properties={node.properties as Record<string, unknown> | null} />

          {/* Summary */}
          <Field label="Summary">
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One or two sentences…"
              className="min-h-[60px]"
            />
          </Field>

          {/* Body */}
          <Field label="Body">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Full content / definition / note (markdown)…"
              className="min-h-[120px] font-mono text-xs"
            />
          </Field>

          {/* Sensitivity */}
          <Field label="Sensitivity">
            <Select value={sensitivity} onValueChange={(v) => setSensitivity(v as typeof sensitivity)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENSITIVITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "private" ? "Private (encrypted)" : s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {dirty && (
            <Button onClick={save} disabled={saving} className="self-start">
              <Save className="size-4" /> {saving ? "Saving…" : "Save changes"}
            </Button>
          )}

          <Separator />

          {/* Connections */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Link2 className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Connections ({detail.connections.length})</h3>
            </div>
            <div className="flex flex-col gap-3">
              {Object.entries(grouped).map(([type, conns]) => (
                <div key={type}>
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {EDGE_TYPE_LABELS[type as EdgeType] ?? type}
                  </div>
                  <div className="flex flex-col gap-1">
                    {conns.map((c) => (
                      <div
                        key={c.edgeId}
                        className="group flex items-start gap-2 rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5"
                      >
                        <span className="mt-0.5 text-[10px] text-muted-foreground">
                          {c.direction === "out" ? "→" : "←"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <button
                            onClick={() => openNode(c.node.id)}
                            className="flex items-center gap-1.5 text-left text-sm text-foreground hover:text-primary"
                          >
                            <NodeTypeBadge type={c.node.type} className="shrink-0" />
                            <span className="truncate">{c.node.title}</span>
                          </button>
                          {c.rationale && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{c.rationale}</p>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {c.weight.toFixed(2)}
                        </span>
                        <button
                          onClick={() =>
                            startTransition(async () => {
                              await removeConnectionAction(c.edgeId);
                              onChanged();
                            })
                          }
                          className="opacity-0 transition group-hover:opacity-100"
                          aria-label="Remove connection"
                        >
                          <X className="size-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <AddConnection srcId={node.id} onAdded={onChanged} />
          </div>

          {/* History */}
          {detail.versions.length > 0 && (
            <>
              <Separator />
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <History className="size-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">How this evolved</h3>
                </div>
                <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
                  {detail.versions.map((v) => {
                    const snap = v.snapshot as { title?: string };
                    return (
                      <li key={v.id} className="relative">
                        <span className="absolute -left-[1.07rem] top-1 size-2 rounded-full bg-muted-foreground" />
                        <div className="text-sm text-foreground">{snap.title ?? "(prior version)"}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.reason} · {timeAgo(v.at)}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </>
          )}

          <Separator />

          {/* Actions */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await relinkNodeAction(node.id);
                  toast({ title: `Re-linked`, description: `${res.created} new edges`, variant: "success" });
                  onChanged();
                })
              }
            >
              <RefreshCw className="size-4" /> Re-link
            </Button>
            <DeleteButton nodeId={node.id} />
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Renders the image + any clarifying question for a memory that's a photo. */
function PhotoBlock({ properties }: { properties: Record<string, unknown> | null }) {
  const p = (properties ?? {}) as { kind?: string; photo?: string; question?: string | null };
  if (p.kind !== "photo" || !p.photo) return null;
  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/internal/photo/${p.photo}`}
        alt="memory"
        className="max-h-[60vh] w-full rounded-xl border border-border object-contain bg-surface-2/40"
      />
      {p.question && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
          <span className="font-medium text-primary">MNEMO asks:</span> {p.question}{" "}
          <span className="text-muted-foreground">— add it in the Body below.</span>
        </p>
      )}
    </div>
  );
}

function groupConnections(conns: NodeDetail["connections"]) {
  const groups: Record<string, NodeDetail["connections"]> = {};
  for (const c of conns) {
    (groups[c.type] ??= []).push(c);
  }
  return groups;
}

function AddConnection({ srcId, onAdded }: { srcId: string; onAdded: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<
    Array<{ id: string; title: string; type: NodeType }>
  >([]);
  const [type, setType] = React.useState<EdgeType>("relates_to");
  const [target, setTarget] = React.useState<{ id: string; title: string } | null>(null);
  const [, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setResults(await searchPickerAction(query, srcId));
    }, 200);
    return () => clearTimeout(t);
  }, [query, srcId]);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add connection
      </Button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <Select value={type} onValueChange={(v) => setType(v as EdgeType)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EDGE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {EDGE_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button onClick={() => setOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      {target ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
          <span className="truncate">{target.title}</span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              onClick={() =>
                startTransition(async () => {
                  const res = await addConnectionAction({ src: srcId, dst: target.id, type });
                  if (res.ok) {
                    toast({ title: "Connected", variant: "success" });
                    setOpen(false);
                    setTarget(null);
                    setQuery("");
                    onAdded();
                  } else toast({ title: "Failed", description: res.error, variant: "error" });
                })
              }
            >
              <Check className="size-4" />
            </Button>
            <button onClick={() => setTarget(null)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a node to connect…"
            className="h-8 text-sm"
          />
          {results.length > 0 && (
            <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setTarget({ id: r.id, title: r.title })}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                >
                  <NodeTypeBadge type={r.type} className="shrink-0" />
                  <span className="truncate">{r.title}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeleteButton({ nodeId }: { nodeId: string }) {
  const [confirming, setConfirming] = React.useState(false);
  const [, startTransition] = React.useTransition();
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="size-4 text-destructive" /> Delete
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Delete + all edges?</span>
      <Button
        variant="destructive"
        size="sm"
        onClick={() =>
          startTransition(async () => {
            await deleteNodeAction(nodeId);
            toast({ title: "Deleted", variant: "success" });
            closeNode();
          })
        }
      >
        Confirm
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
