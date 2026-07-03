"use client";
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Tiny always-on system pulse in the top bar: green = all good, amber = degraded, red = down.
 *  Hidden entirely until the first check answers, and while everything is healthy it stays
 *  quiet (soft green). Click → the health card in Settings. Polls every 90s. */
export function HealthDot() {
  const [level, setLevel] = React.useState<"ok" | "warn" | "down" | null>(null);

  React.useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/internal/health", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((h) => alive && h && setLevel(h.level))
        .catch(() => alive && setLevel("down"));
    check();
    const t = setInterval(check, 90_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!level) return null;
  const color = level === "ok" ? "bg-emerald-500/70" : level === "warn" ? "bg-amber-500" : "bg-red-500";
  return (
    <Link
      href="/settings/agents"
      title={level === "ok" ? "All systems healthy" : level === "warn" ? "Something needs attention" : "Something is down"}
      aria-label="System health"
      className="press flex size-6 items-center justify-center"
    >
      <span className={cn("size-2 rounded-full transition-colors", color, level !== "ok" && "animate-pulse")} />
    </Link>
  );
}
