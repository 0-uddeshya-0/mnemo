import { NODE_TYPE_COLORS, type NodeType } from "@/lib/graph/constants";
import { cn } from "@/lib/utils";

export function NodeTypeBadge({ type, className }: { type: NodeType; className?: string }) {
  const color = NODE_TYPE_COLORS[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        className,
      )}
      style={{ color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {type.replace("_", " ")}
    </span>
  );
}
