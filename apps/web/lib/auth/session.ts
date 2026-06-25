/**
 * Single-user owner auth via iron-session (signed httpOnly cookie). The password is
 * checked in constant time against MNEMOSYNE_PASSWORD. No multi-tenant code exists.
 *
 * Server-only by construction: importing next/headers from a client component errors.
 */
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
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
      secure: env.NODE_ENV === "production",
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
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
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
