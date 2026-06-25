import { requireOwner } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { interviewState } from "@/lib/db/schema";
import { IconRail } from "@/components/shell/icon-rail";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { TopBar } from "@/components/shell/top-bar";
import { CommandPalette } from "@/components/command/command-palette";
import { NodeDrawer } from "@/components/node/node-drawer";
import { OfflineIndicator } from "@/components/offline/offline-indicator";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();

  let completeness = 0;
  try {
    const [row] = await db
      .select({ completeness: interviewState.completeness })
      .from(interviewState)
      .limit(1);
    completeness = row?.completeness ?? 0;
  } catch {
    // DB not migrated yet — degrade gracefully rather than crash the shell.
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <IconRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar completeness={completeness} />
        <main className="relative z-0 min-h-0 flex-1 overflow-hidden">{children}</main>
        <BottomTabBar />
      </div>
      <CommandPalette />
      <NodeDrawer />
      <OfflineIndicator />
    </div>
  );
}
