"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Plus, Search, Share2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", icon: Search, exact: true },
  { href: "/graph", label: "Graph", icon: Share2 },
  { href: "/capture", label: "Capture", icon: Plus },
  { href: "/agent", label: "MNEMO", icon: Bot },
  { href: "/settings/agents", label: "Settings", icon: Settings },
] as const;

/** Native-style bottom tab bar (mobile only). The primary way to move around on a phone. */
export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav className="liquid-glass z-30 shrink-0 pb-safe md:hidden">
      <ul className="grid grid-cols-5">
        {TABS.map((t) => {
          const exact = "exact" in t && t.exact;
          const active = exact ? pathname === t.href : pathname.startsWith(t.href);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-label={t.label}
                aria-current={active ? "page" : undefined}
                className="press flex flex-col items-center justify-center gap-1 pb-1.5 pt-2"
              >
                <Icon
                  className={cn("size-[23px] transition-colors", active ? "text-primary" : "text-muted-foreground")}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span
                  className={cn(
                    "text-[10px] leading-none transition-colors",
                    active ? "font-semibold text-primary" : "font-medium text-muted-foreground",
                  )}
                >
                  {t.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
