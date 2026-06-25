"use client";
import { useEffect } from "react";

/**
 * Material-You "expressive" touch: the gradient-mesh palette adapts to the time of day —
 * warmer toward morning/evening, cooler at midday — a subtle hue shift on --mesh-hue.
 * Stays within ±14° so the emerald brand never drifts. Re-checks hourly.
 */
export function ExpressiveAccent() {
  useEffect(() => {
    function apply() {
      const h = new Date().getHours();
      // midday (12) → 0°, dawn/dusk → warm/cool extremes
      const shift = Math.round(Math.cos((h / 24) * Math.PI * 2) * 14);
      document.documentElement.style.setProperty("--mesh-hue", `${shift}deg`);
    }
    apply();
    const id = setInterval(apply, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
