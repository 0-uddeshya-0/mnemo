/** Google OAuth callback: exchange the authorization code for a refresh token and store it
 * (encrypted) so MNEMO's Google senses + hands light up. Verifies the CSRF state cookie. The
 * refresh token never leaves the Mac. */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthenticated } from "@/lib/auth/session";
import { loadSecrets, secret, setConnectorSecret } from "@/lib/connectors/secrets";
import { env } from "@/lib/env";

export async function GET(req: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = `${env.APP_URL}/settings/agents`;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  if (url.searchParams.get("error")) return done(`${settings}?google=denied`);
  if (!code || !state || !expected || state !== expected) return done(`${settings}?google=bad_state`);

  await loadSecrets();
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: secret("GOOGLE_OAUTH_CLIENT_ID"),
        client_secret: secret("GOOGLE_OAUTH_CLIENT_SECRET"),
        redirect_uri: `${env.APP_URL}/api/connectors/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    const data = (await r.json()) as { refresh_token?: string };
    if (!data.refresh_token) {
      // Google only returns a refresh token on first consent; prompt=consent forces it.
      throw new Error("no refresh_token (revoke MNEMO's access in your Google account, then retry)");
    }
    await setConnectorSecret("GOOGLE_OAUTH_REFRESH_TOKEN", data.refresh_token);
    return done(`${settings}?google=connected`);
  } catch {
    return done(`${settings}?google=error`);
  }
}

function done(location: string): NextResponse {
  const res = NextResponse.redirect(location);
  res.cookies.delete("g_oauth_state");
  return res;
}
