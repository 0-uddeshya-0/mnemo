"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Search, Share2, Upload, Sparkles, MessageCircle, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shell/logo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const NAV = [
  { href: "/", label: "Search", icon: Search, exact: true },
  { href: "/agent", label: "MNEMO (agent)", icon: Bot },
  { href: "/graph", label: "Graph", icon: Share2 },
  { href: "/capture", label: "Capture", icon: Upload },
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/ask", label: "Ask", icon: MessageCircle },
  { href: "/settings/agents", label: "Settings", icon: Settings },
] as const;

export function IconRail() {
  const pathname = usePathname();
  return (
    <nav className="liquid-glass z-20 hidden h-full w-16 shrink-0 flex-col items-center gap-1 py-3 md:flex">
      <Link href="/" className="press mb-3" aria-label="MNEMO home">
        <Logo size={34} />
      </Link>
      <TooltipProvider delayDuration={200}>
        {NAV.map((item) => {
          const exact = "exact" in item && item.exact;
          const active = exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-surface-2 text-primary"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <Icon className="size-[18px]" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
    </nav>
  );
}
