import { cn } from "@/lib/utils";

/**
 * The MNEMO mark — an "M" drawn as a small memory-graph: five nodes joined by edges, with a
 * slightly larger hub at the valley (the "self" everything connects to). Reads as a letter at
 * a glance and as a knowledge graph on a closer look — meaningful, not a bland monogram. On the
 * calm "Ocean Fog" teal squircle. Rendered inline so it stays crisp at any size.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative grid shrink-0 place-items-center overflow-hidden", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: "linear-gradient(150deg,#86A6A8,#4E6E70 52%,#2F4B4E)",
        boxShadow: "inset 0 1.5px 1px rgba(255,255,255,.45), inset 0 0 0 1px rgba(255,255,255,.06), 0 1px 2px rgba(40,70,72,.24)",
      }}
    >
      <svg viewBox="0 0 512 512" width={size * 0.66} height={size * 0.66} fill="none">
        {/* edges — the connective tissue; reads as an M even at tiny sizes */}
        <path
          d="M150 372 V152 L256 292 L362 152 V372"
          stroke="#fff"
          strokeOpacity="0.9"
          strokeWidth="28"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* nodes — memory points; the valley hub is largest (the self) */}
        <g fill="#fff">
          <circle cx="150" cy="152" r="29" />
          <circle cx="362" cy="152" r="29" />
          <circle cx="256" cy="292" r="34" />
          <circle cx="150" cy="372" r="23" fillOpacity="0.92" />
          <circle cx="362" cy="372" r="23" fillOpacity="0.92" />
        </g>
        {/* faint halo on the hub — memory radiating outward */}
        <circle cx="256" cy="292" r="52" stroke="#fff" strokeOpacity="0.42" strokeWidth="7" />
      </svg>
    </span>
  );
}
