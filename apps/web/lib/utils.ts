import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class combiner used by all UI components. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Relative time like "3d ago" for activity/dormant displays. */
export function timeAgo(date: Date | string | number): string {
  const d = typeof date === "object" ? date : new Date(date);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  const units: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Number.POSITIVE_INFINITY, "y"],
  ];
  let value = secs;
  let unit = "s";
  for (const [div, label] of units) {
    if (Math.abs(value) < div) {
      unit = label;
      break;
    }
    value = value / div;
    unit = label;
  }
  if (unit === "s" && value < 30) return "just now";
  return `${Math.round(value)}${unit} ago`;
}
