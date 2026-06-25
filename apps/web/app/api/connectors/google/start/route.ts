/** Begin in-app Google OAuth: redirect the owner to Google's consent screen. Requires the
 * OAuth client ID/secret to already be saved in Settings. A short-lived state cookie guards
 * the callback against CSRF. */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { isAuthenticated } from "@/lib/auth/session";
import { loadSecrets, secret } from "@/lib/connectors/secrets";
import { env } from "@/lib/env";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.modify",
];

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = `${env.APP_URL}/settings/agents`;
  await loadSecrets();
  const clientId = secret("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId) return NextResponse.redirect(`${settings}?google=missing_client`);

  const state = randomBytes(16).toString("hex");
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", `${env.APP_URL}/api/connectors/google/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", SCOPES.join(" "));
  auth.searchParams.set("access_type", "offline"); // ask for a refresh token
  auth.searchParams.set("prompt", "consent"); // force a refresh token even on re-auth
  auth.searchParams.set("state", state);

  const res = NextResponse.redirect(auth.toString());
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
