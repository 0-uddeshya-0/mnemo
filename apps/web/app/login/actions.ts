"use server";
import { redirect } from "next/navigation";
import { login } from "@/lib/auth/session";

export interface LoginState {
  error?: string;
}

// Brute-force throttle. The app has historically listened on every interface
// (see scripts/mnemo-web.sh), so an unthrottled single-password login was
// guessable at network speed. In-process is enough here: one owner, one node.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 5 * 60 * 1000;
let failures: number[] = [];
let lockedUntil = 0;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const now = Date.now();
  if (now < lockedUntil) {
    const secs = Math.ceil((lockedUntil - now) / 1000);
    return { error: `Too many attempts. Try again in ${secs}s.` };
  }
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Enter your password." };

  const ok = await login(password);
  if (!ok) {
    failures = failures.filter((t) => now - t < WINDOW_MS);
    failures.push(now);
    if (failures.length >= MAX_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_MS;
      failures = [];
      return { error: "Too many attempts. Locked for 5 minutes." };
    }
    // Constant-ish delay so failures cost the attacker real time.
    await new Promise((r) => setTimeout(r, 400));
    return { error: "Incorrect password." };
  }
  failures = [];
  redirect("/");
}
