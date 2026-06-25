"use client";
import * as React from "react";
import Link from "next/link";
import { Command, Search } from "lucide-react";
import { openPalette } from "@/components/command/palette-store";
import { Logo } from "@/components/shell/logo";

export function TopBar({ completeness }: { completeness: number }) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pct = Math.round(completeness);

  return (
    <header className="liquid-glass z-20 flex h-14 shrink-0 items-center gap-3 px-4 pt-safe">
      <Link href="/" className="press flex shrink-0 items-center gap-2">
        {/* the badge shows on mobile (desktop has it in the rail) */}
        <Logo size={26} className="md:hidden" />
        <span className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground">MNEMO</span>
      </Link>

      <button
        onClick={openPalette}
        className="group hidden h-9 w-full max-w-md items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:flex"
      >
        <Search className="size-4" />
        <span className="truncate">Search your mind…</span>
        <kbd className="ml-auto flex items-center gap-0.5 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
          <Command className="size-2.5" />K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={openPalette}
          aria-label="Search your mind"
          className="press grid size-9 place-items-center rounded-full text-muted-foreground hover:text-foreground md:hidden"
        >
          <Search className="size-[19px]" />
        </button>
        <Link
          href="/onboarding"
          title="How well MNEMO knows you"
          className="press flex shrink-0 items-center gap-2"
        >
          <span className="hidden text-xs text-muted-foreground sm:inline">{pct}% known</span>
          <span className="relative inline-flex h-1.5 w-14 overflow-hidden rounded-full bg-surface-2">
            <span className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, pct)}%` }} />
          </span>
        </Link>
      </div>
    </header>
  );
}
