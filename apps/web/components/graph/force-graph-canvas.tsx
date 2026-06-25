"use client";
// Thin wrapper around react-force-graph-2d. Loaded via next/dynamic(ssr:false) because
// the library touches `window` at import. It owns the ForceGraphMethods ref internally
// (next/dynamic doesn't forward refs) and hands it back through `onMethods`.
import * as React from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";

type BaseProps = React.ComponentProps<typeof ForceGraph2D>;

export interface ForceGraphCanvasProps extends BaseProps {
  onMethods?: (methods: ForceGraphMethods) => void;
}

export default function ForceGraphCanvas({ onMethods, ...props }: ForceGraphCanvasProps) {
  const ref = React.useRef<ForceGraphMethods | undefined>(undefined);
  React.useEffect(() => {
    if (ref.current) onMethods?.(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ForceGraph2D ref={ref} {...props} />;
}
