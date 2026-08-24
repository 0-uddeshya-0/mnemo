"use client";

import * as React from "react";
import { Copy, Download, ImageOff, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toaster";

/** All engine calls go through the server-side proxy — the dashboard server sets no CORS. */
const PROXY = "/api/internal/content";

interface EngineImage {
  url: string;
  name: string;
}

interface EngineMeta {
  platform?: string;
  format?: string;
  status?: string;
  publish_at?: string;
  hook?: string;
  cta?: string;
  audit?: string;
  alt_text?: string;
  [key: string]: string | undefined;
}

interface EngineItem {
  file: string;
  meta: EngineMeta;
  raw: string;
  images: EngineImage[];
}

interface EngineState {
  drafts: EngineItem[];
  approved: EngineItem[];
}

type LoadStatus = "loading" | "ready" | "offline" | "error";
type ChipVariant = "default" | "secondary" | "outline";

function statusChip(meta: EngineMeta): { label: string; variant: ChipVariant } {
  if (meta.status === "approved" || meta.status === "scheduled" || meta.status === "published") {
    return { label: "approved", variant: "default" };
  }
  if (/^pass/i.test(meta.audit ?? "")) {
    return { label: "audit pass", variant: "secondary" };
  }
  return { label: "in progress", variant: "outline" };
}

/** Mirrors the dashboard server's own extraction (dashboard/server.mjs igZip). */
function extractCaption(raw: string): string {
  const m = raw.match(/## caption\s*\n+([\s\S]*?)(?=\n## |$)/);
  return m ? m[1].trim() : "";
}

export function ContentHub() {
  const [state, setState] = React.useState<EngineState | null>(null);
  const [status, setStatus] = React.useState<LoadStatus>("loading");
  const [busyFile, setBusyFile] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`${PROXY}/api/state`, { cache: "no-store" });
      if (res.status === 503) {
        setStatus("offline");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = (await res.json()) as EngineState;
      setState(data);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function act(file: string, kind: "approve" | "reject", rejectReason?: string) {
    if (!state) return;
    setBusyFile(file);
    // Optimistic: pull it out of the review queue immediately; `load()` in `finally`
    // reconciles with ground truth either way (puts it back if the server refused).
    setState({ ...state, drafts: state.drafts.filter((d) => d.file !== file) });
    try {
      const res = await fetch(`${PROXY}/api/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "reject" ? { file, reason: rejectReason ?? "" } : { file }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast({
          title: kind === "approve" ? "Approve refused" : "Reject failed",
          description: data.error || `HTTP ${res.status}`,
          variant: "error",
        });
      } else {
        toast({ title: kind === "approve" ? "Approved" : "Rejected", variant: "success" });
      }
    } catch {
      toast({ title: "content-engine offline", variant: "error" });
    } finally {
      setBusyFile(null);
      void load();
    }
  }

  async function copyCaption(item: EngineItem) {
    const caption = extractCaption(item.raw);
    if (!caption) {
      toast({ title: "No caption section found", variant: "error" });
      return;
    }
    try {
      await navigator.clipboard.writeText(caption);
      toast({ title: "Caption copied", variant: "success" });
    } catch {
      toast({ title: "Copy failed — check clipboard permission", variant: "error" });
    }
  }

  if (status === "loading") {
    return (
      <div className="mx-auto h-full w-full max-w-5xl overflow-y-auto px-6 py-8">
        <Skeleton className="mb-6 h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-6 py-8">
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <WifiOff className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Mission Control is offline — run{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">bin/engine hq</code> on this
            Mac.
          </p>
        </Card>
      </div>
    );
  }

  if (status === "error" || !state) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center px-6 py-8">
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t reach the content-engine. Try refreshing.
        </Card>
      </div>
    );
  }

  const instagramItems = [...state.drafts, ...state.approved]
    .filter((item) => item.meta.platform === "instagram")
    .sort((a, b) => (b.meta.publish_at ?? b.file).localeCompare(a.meta.publish_at ?? a.file));

  const scheduledGroups = new Map<string, EngineItem[]>();
  for (const item of state.approved) {
    const key = item.meta.publish_at || "unscheduled";
    const list = scheduledGroups.get(key) ?? [];
    list.push(item);
    scheduledGroups.set(key, list);
  }
  const scheduledEntries = [...scheduledGroups.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="mx-auto h-full w-full max-w-5xl overflow-y-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="display-title text-3xl text-foreground">Content</h1>
        <p className="text-sm text-muted-foreground">Your content-engine pipeline, inside MNEMO.</p>
      </div>

      <Tabs defaultValue="instagram">
        <TabsList>
          <TabsTrigger value="instagram">Instagram</TabsTrigger>
          <TabsTrigger value="review">
            Review queue{state.drafts.length > 0 ? ` (${state.drafts.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled &amp; published</TabsTrigger>
        </TabsList>

        <TabsContent value="instagram">
          {instagramItems.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No Instagram posts yet.</Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {instagramItems.map((item) => {
                const cover = item.images[0];
                const chip = statusChip(item.meta);
                return (
                  <Card key={item.file} className="flex flex-col overflow-hidden p-0">
                    <div className="aspect-square w-full bg-surface-2">
                      {cover ? (
                        <img
                          src={`${PROXY}${cover.url}`}
                          alt={item.meta.alt_text ?? ""}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageOff className="size-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={chip.variant}>{chip.label}</Badge>
                        <span className="text-[11px] text-muted-foreground">{item.meta.publish_at ?? "—"}</span>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {item.meta.format ?? item.meta.hook ?? ""}
                      </p>
                      <div className="mt-auto flex items-center gap-2 pt-1">
                        {item.images.length > 0 && (
                          <Button asChild size="sm" variant="secondary">
                            <a href={`${PROXY}/api/ig-zip?file=${encodeURIComponent(item.file)}`}>
                              <Download className="size-3.5" />
                              Download
                            </a>
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => void copyCaption(item)}>
                          <Copy className="size-3.5" />
                          Caption
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="review">
          {state.drafts.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Nothing waiting on you.</Card>
          ) : (
            <div className="flex flex-col gap-2">
              {state.drafts.map((item) => {
                const chip = statusChip(item.meta);
                const isBusy = busyFile === item.file;
                return (
                  <div key={item.file} className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center gap-2">
                      <Badge variant="mono">{item.meta.platform ?? "?"}</Badge>
                      <Badge variant={chip.variant}>{chip.label}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-foreground">{item.meta.hook || item.file}</p>

                    {rejecting === item.file ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          autoFocus
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Reason (optional)"
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isBusy}
                          onClick={() => {
                            void act(item.file, "reject", reason);
                            setRejecting(null);
                            setReason("");
                          }}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRejecting(null);
                            setReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" disabled={isBusy} onClick={() => void act(item.file, "approve")}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => setRejecting(item.file)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="scheduled">
          {scheduledEntries.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Nothing approved yet.</Card>
          ) : (
            <div className="flex flex-col gap-5">
              {scheduledEntries.map(([date, items]) => (
                <div key={date}>
                  <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    {date}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {items.map((item) => (
                      <div
                        key={item.file}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="mono">{item.meta.platform ?? "?"}</Badge>
                          <span className="truncate text-sm text-foreground">{item.meta.hook || item.file}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
