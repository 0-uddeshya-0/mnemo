"use client";
import * as React from "react";
import { Brain, CloudDownload, HardDriveDownload, Wifi, WifiOff } from "lucide-react";
import { useOffline } from "@/components/offline/use-offline";
import { prepareOfflineSemantic } from "@/lib/offline/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { timeAgo } from "@/lib/utils";

type AiState = "idle" | "loading" | "ready" | "error";

export function OfflineCard() {
  const { online, meta, pending, syncing, sync } = useOffline();
  const [ai, setAi] = React.useState<AiState>("idle");
  const [aiProgress, setAiProgress] = React.useState(0);

  async function onSync() {
    const r = await sync();
    if (r) toast({ title: "Available offline", description: `${r.nodes} nodes cached`, variant: "success" });
    else toast({ title: "Sync failed", variant: "error" });
  }

  async function enableSemantic() {
    setAi("loading");
    setAiProgress(0);
    try {
      await prepareOfflineSemantic((f) => setAiProgress(Math.round(f * 100)));
      setAi("ready");
      toast({ title: "Offline AI ready", description: "Semantic search works with no network", variant: "success" });
    } catch {
      setAi("error");
      toast({ title: "Couldn't load the offline model", variant: "error" });
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <HardDriveDownload className="size-4 text-primary" />
        <h2 className="text-sm font-medium text-foreground">Offline & devices</h2>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5 text-[#d97706]" />}
          {online ? "online" : "offline"}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Cache your whole graph on this device so you can navigate + search it with zero network.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void onSync()} disabled={syncing || !online}>
            <CloudDownload className={syncing ? "size-4 animate-pulse" : "size-4"} />
            {syncing ? "Caching…" : meta ? "Re-sync" : "Make available offline"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {meta ? `${meta.nodes} nodes cached · synced ${timeAgo(meta.syncedAt)}` : "not yet cached"}
            {pending > 0 ? ` · ${pending} pending upload` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <Button variant="secondary" onClick={() => void enableSemantic()} disabled={ai === "loading" || ai === "ready" || !online}>
            <Brain className={ai === "loading" ? "size-4 animate-pulse" : "size-4"} />
            {ai === "ready"
              ? "Offline AI search on"
              : ai === "loading"
                ? `Downloading model… ${aiProgress}%`
                : "Enable offline AI search"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {ai === "ready"
              ? "Semantic search runs on-device, no network."
              : "One-time ~90MB model download, then it works fully offline."}
          </span>
        </div>
      </div>
    </Card>
  );
}
