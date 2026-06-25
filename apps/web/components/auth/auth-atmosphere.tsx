/**
 * The login backdrop — a faint memory-constellation with a slow breathing aura behind the mark:
 * "your second mind, waking up." Calm and on-brand (Ocean Fog), kept to the periphery so the
 * center stays clean for the form. Reduced-motion safe (the global rule freezes aura + twinkles;
 * everything stays visible). Purely decorative, so aria-hidden + pointer-events-none.
 */
const NODES: { x: number; y: number; r: number; tw?: boolean }[] = [
  { x: 96, y: 104, r: 3, tw: true },
  { x: 214, y: 58, r: 2 },
  { x: 58, y: 286, r: 2.5 },
  { x: 168, y: 452, r: 3, tw: true },
  { x: 92, y: 642, r: 2 },
  { x: 322, y: 690, r: 2.5 },
  { x: 528, y: 86, r: 2, tw: true },
  { x: 712, y: 62, r: 2.5 },
  { x: 1104, y: 96, r: 3 },
  { x: 1012, y: 214, r: 2, tw: true },
  { x: 1156, y: 372, r: 2.5 },
  { x: 1074, y: 566, r: 3 },
  { x: 968, y: 688, r: 2, tw: true },
  { x: 766, y: 712, r: 2.5 },
];

// Edges connect near neighbours into a loose graph (index pairs into NODES).
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [1, 6],
  [6, 7],
  [8, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [12, 13],
  [8, 10],
];

export function AuthAtmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="auth-aura" />
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 1200 760"
        preserveAspectRatio="xMidYMid slice"
      >
        <g stroke="var(--color-glow)" strokeOpacity="0.28" strokeWidth="1.4">
          {EDGES.map(([a, b], i) => (
            <line key={i} x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y} />
          ))}
        </g>
        <g fill="var(--color-glow)" fillOpacity="0.7">
          {NODES.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={n.r} className={n.tw ? "auth-star" : undefined} />
          ))}
        </g>
      </svg>
    </div>
  );
}
