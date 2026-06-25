"use client";
/** Tiny pub/sub for the cmd+k command palette open state (no external state lib). */
type Listener = (open: boolean) => void;

let open = false;
const listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l(open);
}

export function openPalette() {
  open = true;
  emit();
}
export function closePalette() {
  open = false;
  emit();
}
export function subscribePalette(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
