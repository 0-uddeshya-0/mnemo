"use client";
/** Global store for the reusable node detail drawer. Any component calls openNode(id). */
type Listener = (id: string | null) => void;

let current: string | null = null;
const listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l(current);
}

export function openNode(id: string) {
  current = id;
  emit();
}
export function closeNode() {
  current = null;
  emit();
}
export function subscribeNode(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
