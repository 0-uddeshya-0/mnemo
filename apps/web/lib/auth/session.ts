/**
 * Single-user owner auth via iron-session (signed httpOnly cookie). The password is
 * checked in constant time against MNEMOSYNE_PASSWORD. No multi-tenant code exists.
 *
 * Server-only by construction: importing next/headers from a client component errors.
 */
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { env, requireEnv } from "@/lib/env";

export interface SessionData {
  authenticated?: boolean;
}

function sessionOptions(): SessionOptions {
  return {
    password: requireEnv("SESSION_SECRET"),
    cookieName: "mnemosyne_session",
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      // Secure must follow the actual serving scheme, not NODE_ENV: `next start` is
      // production but serves plain HTTP on localhost/LAN, where browsers refuse to
      // store Secure cookies on non-localhost hosts (login appeared to "not stick").
      // Fronting the app with HTTPS later? Set APP_URL to the https:// origin.
      secure: env.APP_URL.startsWith("https://"),
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  };
}

export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions());
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session.authenticated === true;
}

export function checkPassword(input: string): boolean {
  const expected = requireEnv("MNEMOSYNE_PASSWORD");
  // Hash both sides to equal length first: the previous early return on length
  // mismatch leaked the password's length through response timing.
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function login(password: string): Promise<boolean> {
  if (!checkPassword(password)) return false;
  const session = await getSession();
  session.authenticated = true;
  await session.save();
  return true;
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
