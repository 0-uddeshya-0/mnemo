"use client";
import * as React from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toaster";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Drop in photos → MNEMO looks at each (local vision model), remembers it, asks if unsure. */
export function PhotoUpload() {
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [note, setNote] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of imgs) fd.append("file", f);
      if (note.trim()) fd.append("note", note.trim());
      const res = await fetch("/api/internal/photo", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: `MNEMO is looking at ${j.queued} photo${j.queued === 1 ? "" : "s"}…`,
          description: "It'll describe each, fold it into your memory, and ask if it's unsure who or where.",
          variant: "success",
        });
        setNote("");
      } else {
        toast({ title: "Couldn't add that", description: j.error ?? "Unknown error", variant: "error" });
      }
    } catch (e) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="surface p-5">
      <h3 className="mb-1 text-sm font-medium text-foreground">Add photos</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Pictures of you, the people you love, places, things, your surroundings — I look at each,
        remember it, and ask if I need to know who or where.
      </p>

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional — anything I should know about these? (who, where, when)"
        className="mb-3 min-h-[44px] resize-none text-sm"
      />

      <label
        htmlFor="photo-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-8 text-center transition-colors",
          drag && "border-primary/60 bg-primary/5",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {busy ? <Loader2 className="size-6 animate-spin text-primary" /> : <ImagePlus className="size-6 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">{busy ? "Uploading…" : "Choose photos or drag them here"}</span>
        <span className="text-xs text-muted-foreground">JPEG / PNG / WebP / HEIC · up to 20MB each · multiple at once</span>
        <input
          ref={inputRef}
          id="photo-file"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
          }}
        />
      </label>

      <p className="mt-3 text-xs text-muted-foreground">Looked at and stored entirely on your Mac. Never uploaded anywhere.</p>
    </div>
  );
}
