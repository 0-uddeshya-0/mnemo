"use client";
import * as React from "react";
import { AtSign, BookMarked, Bookmark, FileText, History, Upload } from "lucide-react";
import {
  browserImportAction,
  browserParseAction,
  notionImportAction,
  pocketImportAction,
  readwiseSyncAction,
  xImportAction,
  type ConnectorStatus,
  type HistoryCandidate,
} from "@/app/(app)/capture/connectors-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { cn, timeAgo } from "@/lib/utils";

export function ConnectorsPanel({ initial }: { initial: ConnectorStatus[] }) {
  const status = React.useMemo(() => new Map(initial.map((s) => [s.provider, s])), [initial]);

  return (
    <div className="flex flex-col gap-3 py-2">
      <ConnectorCard
        icon={BookMarked}
        title="Readwise / Kindle"
        desc="Pull your books + highlights. Highlights become quote nodes linked to each book."
        status={status.get("readwise")}
      >
        <ReadwiseForm />
      </ConnectorCard>

      <ConnectorCard
        icon={Bookmark}
        title="Pocket"
        desc="Upload your Pocket export (HTML/CSV). Each saved article is fetched + extracted."
        status={status.get("pocket")}
      >
        <FileImport accept=".html,.csv,.txt" onText={pocketImportAction} label="Upload export" />
      </ConnectorCard>

      <ConnectorCard
        icon={FileText}
        title="Notion"
        desc="Upload exported Markdown pages. Long pages become creative works, short ones notes."
        status={status.get("notion")}
      >
        <NotionImport />
      </ConnectorCard>

      <ConnectorCard
        icon={AtSign}
        title="X / Twitter archive"
        desc="Upload tweets.js / tweets.json. Your own tweets seed interests + beliefs."
        status={status.get("x_archive")}
      >
        <FileImport accept=".js,.json,.txt" onText={xImportAction} label="Upload tweets file" />
      </ConnectorCard>

      <ConnectorCard
        icon={History}
        title="Browser history"
        desc="Upload an export, then pick which pages to ingest (no noise auto-imported)."
        status={status.get("browser")}
      >
        <BrowserImport />
      </ConnectorCard>
    </div>
  );
}

function ConnectorCard({
  icon: Icon,
  title,
  desc,
  status,
  children,
}: {
  icon: typeof Upload;
  title: string;
  desc: string;
  status?: ConnectorStatus;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {status?.lastRunAt ? `${status.status} · ${timeAgo(status.lastRunAt)}` : status?.status ?? "idle"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ReadwiseForm() {
  const [token, setToken] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <div className="flex gap-2">
      <Input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Readwise access token"
        type="password"
        className="h-8 min-w-0 flex-1 text-sm"
      />
      <Button
        size="sm"
        disabled={pending || !token.trim()}
        onClick={() =>
          start(async () => {
            const res = await readwiseSyncAction(token);
            if (res.ok) toast({ title: `Queued ${res.queued} books`, variant: "success" });
            else toast({ title: "Readwise failed", description: res.error, variant: "error" });
          })
        }
      >
        Sync
      </Button>
    </div>
  );
}

function FileImport({
  accept,
  label,
  onText,
}: {
  accept: string;
  label: string;
  onText: (text: string) => Promise<{ ok: true; queued: number } | { ok: false; error: string }>;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => ref.current?.click()}>
        <Upload className="size-4" /> {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          start(async () => {
            const res = await onText(text);
            if (res.ok) toast({ title: `Queued ${res.queued} items`, variant: "success" });
            else toast({ title: "Import failed", description: res.error, variant: "error" });
          });
        }}
      />
    </>
  );
}

function NotionImport() {
  const ref = React.useRef<HTMLInputElement>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => ref.current?.click()}>
        <Upload className="size-4" /> Upload Markdown files
      </Button>
      <input
        ref={ref}
        type="file"
        accept=".md,.markdown,.txt,.csv"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          const payload = await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() })));
          start(async () => {
            const res = await notionImportAction(payload);
            if (res.ok) toast({ title: `Queued ${res.queued} pages`, variant: "success" });
          });
        }}
      />
    </>
  );
}

function BrowserImport() {
  const ref = React.useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = React.useState<HistoryCandidate[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, start] = React.useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" variant="secondary" onClick={() => ref.current?.click()}>
        <Upload className="size-4" /> Upload history export
      </Button>
      <input
        ref={ref}
        type="file"
        accept=".json,.html,.csv,.txt"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          const cands = await browserParseAction(text);
          setCandidates(cands);
          setSelected(new Set());
        }}
      />
      {candidates.length > 0 && (
        <>
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="text-muted-foreground">
              {selected.size} of {candidates.length} selected
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => setSelected(new Set(candidates.map((c) => c.url)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:underline disabled:opacity-40"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
            {candidates.map((c) => (
              <label
                key={c.url}
                className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.url)}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      next.has(c.url) ? next.delete(c.url) : next.add(c.url);
                      return next;
                    })
                  }
                />
                <span className="truncate text-foreground">{c.title}</span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() =>
              start(async () => {
                const res = await browserImportAction([...selected]);
                if (res.ok) {
                  toast({ title: `Queued ${res.queued} pages`, variant: "success" });
                  setCandidates([]);
                  setSelected(new Set());
                }
              })
            }
          >
            Ingest {selected.size} selected
          </Button>
        </>
      )}
    </div>
  );
}
