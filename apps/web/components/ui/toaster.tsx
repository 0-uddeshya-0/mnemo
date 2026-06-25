"use client";
import * as React from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "success" | "error" | "info";

export interface ToastItem {
  id: string;
  title?: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

type Listener = (toasts: ToastItem[]) => void;
let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l(toasts);
}

export function toast(input: {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}): string {
  const id = Math.random().toString(36).slice(2);
  const item: ToastItem = {
    id,
    title: input.title,
    description: input.description,
    variant: input.variant ?? "default",
    duration: input.duration ?? 4000,
  };
  toasts = [...toasts, item];
  emit();
  if (item.duration > 0) setTimeout(() => dismissToast(id), item.duration);
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const ICONS: Record<ToastVariant, React.ReactNode> = {
  default: <Info className="size-4 text-muted-foreground" />,
  success: <CheckCircle2 className="size-4 text-primary" />,
  error: <AlertCircle className="size-4 text-destructive" />,
  info: <Info className="size-4 text-[#60a5fa]" />,
};

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>(toasts);
  React.useEffect(() => {
    const l: Listener = (t) => setItems([...t]);
    listeners.add(l);
    l(toasts);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-full max-w-sm flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "glass animate-fade-up pointer-events-auto flex items-start gap-3 rounded-xl p-3",
          )}
        >
          <div className="mt-0.5 shrink-0">{ICONS[t.variant]}</div>
          <div className="min-w-0 flex-1">
            {t.title && <div className="text-sm font-medium text-foreground">{t.title}</div>}
            {t.description && (
              <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
            )}
          </div>
          <button
            onClick={() => dismissToast(t.id)}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
