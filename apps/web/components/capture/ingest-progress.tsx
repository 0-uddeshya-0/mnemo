"use client";
import * as React from "react";
import Link from "next/link";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { PIPELINE_STAGES } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

interface JobStatus {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error";
  stage: string | null;
  result: Record<string, unknown>;
  error: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  acquire: "Acquire",
  chunk: "Chunk",
  embed: "Embed",
  extract: "Extract",
  link: "Link",
  reconcile: "Reconcile",
};

export function IngestProgress({ jobId, label }: { jobId: string; label: string }) {
  const [job, setJob] = React.useState<JobStatus | null>(null);

  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (res.ok && active) {
          const data = (await res.json()) as JobStatus;
          setJob(data);
          if (data.status === "done" || data.status === "error") return;
        }
      } catch {
        /* transient; keep polling */
      }
      if (active) timer = setTimeout(tick, 1200);
    };
    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  const currentIdx = job?.stage ? PIPELINE_STAGES.indexOf(job.stage as never) : -1;
  const done = job?.status === "done";
  const error = job?.status === "error";
  const duplicate = done && Boolean(job?.result?.duplicate);
  const learned = (job?.result?.learned as { title: string; type: string }[] | undefined) ?? [];

  return (
    <div className="surface animate-fade-up p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="truncate text-sm text-foreground">{label}</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {error ? "error" : done ? (duplicate ? "duplicate" : "done") : (job?.status ?? "queued")}
        </span>
      </div>

      {error ? (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{job?.error ?? "Ingestion failed."}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {PIPELINE_STAGES.map((stage, i) => {
            const isDone = done || (currentIdx >= 0 && i < currentIdx);
            const isCurrent = !done && i === currentIdx;
            return (
              <span
                key={stage}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                  isDone && "border-primary/30 bg-primary/10 text-primary",
                  isCurrent && "border-primary/50 bg-primary/15 text-primary",
                  !isDone && !isCurrent && "border-border bg-surface-2 text-muted-foreground",
                )}
              >
                {isDone ? (
                  <Check className="size-3" />
                ) : isCurrent ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                {STAGE_LABELS[stage]}
              </span>
            );
          })}
        </div>
      )}

      {done && !error && (
        <div className="mt-3">
          {duplicate ? (
            <p className="text-xs text-muted-foreground">
              Already in your brain — nothing new to learn here.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">What I learned</span>
                <Link href="/graph" className="text-xs text-primary hover:underline">
                  View in graph →
                </Link>
              </div>
              {learned.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {learned.map((n, i) => (
                    <li
                      key={i}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px]"
                    >
                      <span className="shrink-0 text-muted-foreground">{n.type.replace(/_/g, " ")}</span>
                      <span className="truncate text-foreground">{n.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Saved it — nothing distinct enough stood out to extract.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {Number(job?.result?.createdNodes ?? 0)} new ·{" "}
                {Number(job?.result?.edges ?? 0)} links woven into your graph
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
