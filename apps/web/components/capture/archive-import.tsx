"use client";
import * as React from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/** Drop an exported archive (WhatsApp, X, Claude, Keep, journal) → MNEMO distills the signal. */
export function ArchiveImport() {
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/internal/import", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: `Importing your ${j.source}…`,
          description: "MNEMO is keeping the meaningful parts and skipping the noise. New memories will appear shortly.",
          variant: "success",
        });
      } else {
        toast({ title: "Couldn't import that", description: j.error ?? "Unknown error", variant: "error" });
      }
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="surface p-5">
      <h3 className="mb-1 text-sm font-medium text-foreground">Import an archive</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Drop an export and I&apos;ll fold the meaningful parts of your life into your brain —
        experiences, turning points, beliefs — and quietly skip the noise.
      </p>

      <label
        htmlFor="archive-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-8 text-center transition-colors",
          drag && "border-primary/60 bg-primary/5",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {busy ? (
          <Loader2 className="size-6 animate-spin text-primary" />
        ) : (
          <FileUp className="size-6 text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground">
          {busy ? "Uploading…" : "Choose a file or drag it here"}
        </span>
        <span className="max-w-xs text-xs text-muted-foreground">
          WhatsApp chat (.txt) · X/Twitter tweets.js · Claude / Google&nbsp;Keep export (.json) ·
          any journal (.md/.txt)
        </span>
        <input
          ref={inputRef}
          id="archive-file"
          type="file"
          accept=".txt,.md,.json,.js,text/plain,application/json"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </label>

      <p className="mt-3 text-xs text-muted-foreground">
        Up to 15&nbsp;MB. Everything is processed on your Mac and never leaves it.
      </p>
    </div>
  );
}
