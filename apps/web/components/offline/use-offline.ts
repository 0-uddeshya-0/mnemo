"use client";
import * as React from "react";
import {
  flushQueue,
  getCachedMeta,
  pendingCount,
  syncSnapshot,
  type SyncResult,
} from "@/lib/offline/store";

export interface OfflineState {
  online: boolean;
  meta: { syncedAt: string; nodes: number } | null;
  pending: number;
  syncing: boolean;
  sync: () => Promise<SyncResult | null>;
}

export function useOffline(): OfflineState {
  const [online, setOnline] = React.useState(true);
  const [meta, setMeta] = React.useState<{ syncedAt: string; nodes: number } | null>(null);
  const [pending, setPending] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setMeta(await getCachedMeta().catch(() => null));
    setPending(await pendingCount().catch(() => 0));
  }, []);

  const sync = React.useCallback(async (): Promise<SyncResult | null> => {
    setSyncing(true);
    try {
      const r = await syncSnapshot();
      await flushQueue();
      await refresh();
      return r;
    } catch {
      return null;
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  React.useEffect(() => {
    setOnline(navigator.onLine);
    void refresh();
    const onOnline = () => {
      setOnline(true);
      void flushQueue().then(refresh);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  return { online, meta, pending, syncing, sync };
}
