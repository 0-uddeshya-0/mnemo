"use client";
import * as React from "react";
import { FileText, ImagePlus, Link2, NotebookPen, Upload, Download, FileUp } from "lucide-react";
import { PhotoUpload } from "@/components/capture/photo-upload";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { IngestProgress } from "@/components/capture/ingest-progress";
import { captureFile, captureNote, captureUrl } from "@/app/(app)/capture/actions";
import { cn } from "@/lib/utils";

interface Job {
  jobId: string;
  label: string;
}

export function CapturePanel({ importTab }: { importTab?: React.ReactNode }) {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [pending, startTransition] = React.useTransition();

  function addJob(jobId: string, label: string) {
    setJobs((prev) => [{ jobId, label }, ...prev].slice(0, 8));
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="display-title mb-1 text-2xl text-foreground sm:text-3xl">Capture</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Everything flows through one pipeline — parsed, embedded, linked into your graph.
      </p>

      <Tabs defaultValue="upload">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="upload" className="shrink-0">
            <Upload className="size-4" /> <span className="hidden sm:inline">Upload</span>
          </TabsTrigger>
          <TabsTrigger value="url" className="shrink-0">
            <Link2 className="size-4" /> <span className="hidden sm:inline">URL</span>
          </TabsTrigger>
          <TabsTrigger value="note" className="shrink-0">
            <NotebookPen className="size-4" /> <span className="hidden sm:inline">Note</span>
          </TabsTrigger>
          <TabsTrigger value="photos" className="shrink-0">
            <ImagePlus className="size-4" /> <span className="hidden sm:inline">Photos</span>
          </TabsTrigger>
          <TabsTrigger value="import" className="shrink-0">
            <Download className="size-4" /> <span className="hidden sm:inline">Import</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload">
          <UploadTab
            disabled={pending}
            onSubmit={(fd, name) =>
              startTransition(async () => {
                const res = await captureFile(fd);
                if (res.ok) {
                  addJob(res.ingestJobId, name);
                  toast({ title: "Queued", description: name, variant: "success" });
                } else toast({ title: "Upload failed", description: res.error, variant: "error" });
              })
            }
          />
        </TabsContent>

        <TabsContent value="url">
          <UrlTab
            disabled={pending}
            onSubmit={(url, note) =>
              startTransition(async () => {
                const res = await captureUrl({ url, note });
                if (res.ok) {
                  addJob(res.ingestJobId, url);
                  toast({ title: "Queued", description: url, variant: "success" });
                } else toast({ title: "Couldn’t queue URL", description: res.error, variant: "error" });
              })
            }
          />
        </TabsContent>

        <TabsContent value="note">
          <NoteTab
            disabled={pending}
            onSubmit={(input) =>
              startTransition(async () => {
                const res = await captureNote(input);
                if (res.ok) {
                  addJob(res.ingestJobId, input.title || input.body.slice(0, 48));
                  toast({ title: "Captured", variant: "success" });
                } else toast({ title: "Couldn’t capture", description: res.error, variant: "error" });
              })
            }
          />
        </TabsContent>

        <TabsContent value="photos">
          <PhotoUpload />
        </TabsContent>

        <TabsContent value="import">
          {importTab ?? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Connectors (Readwise, Pocket, Notion, X archive, browser history) live here.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {jobs.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent ingests
          </h2>
          <div className="flex flex-col gap-2">
            {jobs.map((j) => (
              <IngestProgress key={j.jobId} jobId={j.jobId} label={j.label} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadTab({
  onSubmit,
  disabled,
}: {
  onSubmit: (fd: FormData, name: string) => void;
  disabled: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("file", file);
      onSubmit(fd, file.name);
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center transition-colors",
        dragging && "border-primary/60 bg-primary/5",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <FileUp className="size-7 text-muted-foreground" />
      <div>
        <p className="text-sm text-foreground">Drop files or click to browse</p>
        <p className="mt-1 text-xs text-muted-foreground">PDF · EPUB · DOCX · TXT · Markdown</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.epub,.docx,.txt,.md,.markdown"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}

function UrlTab({
  onSubmit,
  disabled,
}: {
  onSubmit: (url: string, note?: string) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = React.useState("");
  const [note, setNote] = React.useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onSubmit(url.trim(), note.trim() || undefined);
        setUrl("");
        setNote("");
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="url">Article URL</Label>
        <Input
          id="url"
          type="url"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea
          id="note"
          placeholder="Why are you saving this?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || !url.trim()}>
          <FileText className="size-4" /> Extract & link
        </Button>
      </div>
    </form>
  );
}

function NoteTab({
  onSubmit,
  disabled,
}: {
  onSubmit: (input: {
    title?: string;
    body: string;
    nodeType: "note" | "creative_work" | "belief" | "quote";
    sensitivity: "public" | "normal" | "private";
  }) => void;
  disabled: boolean;
}) {
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [nodeType, setNodeType] = React.useState<"note" | "creative_work" | "belief" | "quote">("note");
  const [sensitivity, setSensitivity] = React.useState<"public" | "normal" | "private">("normal");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSubmit({ title: title.trim() || undefined, body, nodeType, sensitivity });
        setTitle("");
        setBody("");
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex gap-3">
        <div className="flex-1">
          <Label className="mb-1.5 block">Type</Label>
          <Select value={nodeType} onValueChange={(v) => setNodeType(v as typeof nodeType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="note">Note</SelectItem>
              <SelectItem value="creative_work">Creative work</SelectItem>
              <SelectItem value="belief">Belief</SelectItem>
              <SelectItem value="quote">Quote</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label className="mb-1.5 block">Sensitivity</Label>
          <Select value={sensitivity} onValueChange={(v) => setSensitivity(v as typeof sensitivity)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="private">Private (encrypted)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea
        placeholder="What's on your mind?"
        className="min-h-[180px]"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || !body.trim()}>
          <NotebookPen className="size-4" /> Capture
        </Button>
      </div>
    </form>
  );
}
