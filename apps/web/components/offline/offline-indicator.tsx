"use client";
import { CloudOff, RefreshCw } from "lucide-react";
import { useOffline } from "@/components/offline/use-offline";

/** A quiet status pill — only appears when offline or there are pending captures to flush. */
export function OfflineIndicator() {
  const { online, pending, syncing } = useOffline();
  if (online && pending === 0) return null;

  return (
    <div className="glass fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs md:bottom-4 md:left-4 md:translate-x-0">
      {!online ? (
        <>
          <CloudOff className="size-3.5 text-[#d97706]" />
          <span className="text-foreground">Offline · reading from this device</span>
        </>
      ) : (
        <>
          <RefreshCw className={syncing ? "size-3.5 animate-spin text-primary" : "size-3.5 text-primary"} />
          <span className="text-foreground">Syncing {pending} pending…</span>
        </>
      )}
    </div>
  );
}
