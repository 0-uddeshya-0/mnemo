/**
 * One-time Google authorization for MNEMO's Calendar + Gmail connector.
 *
 * Prereq (free, ~3 min): in Google Cloud Console create an OAuth client of type
 * "Desktop app" and enable the Calendar API + Gmail API. Put its id/secret in .env as
 * GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET, then run:  pnpm connect:google
 *
 * This opens a browser consent screen, captures the code on a loopback port, exchanges it
 * for a long-lived refresh token, and prints the line to add to .env. Tokens stay on your Mac.
 */
import "@/lib/server/load-env";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { loadSecrets, secret, setConnectorSecret } from "@/lib/connectors/secrets";

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

async function main() {
  // Read client id/secret from the in-app store (Settings → connectors) first, then .env.
  await loadSecrets();
  const clientId = secret("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = secret("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error(
      "No Google OAuth client found. In MNEMO → Settings → Senses & Hands, paste your OAuth client ID + secret\n" +
        "(create a 'Desktop app' client in Google Cloud Console with the Calendar + Gmail APIs enabled), then re-run.",
    );
    process.exit(1);
  }

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES.join(" "),
    });

  const code: string = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT);
      const c = url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h2>MNEMO is connected to Google. You can close this tab.</h2>");
      if (c) {
        server.close();
        resolve(c);
      }
    });
    server.listen(PORT, () => {
      console.log("→ Opening Google consent in your browser…");
      console.log("  If it doesn't open, paste this URL:\n  " + authUrl + "\n");
      exec(`open "${authUrl}"`);
    });
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!data.refresh_token) {
    console.error("No refresh token returned:", data.error_description ?? data.error ?? JSON.stringify(data));
    console.error("Tip: revoke prior access at myaccount.google.com/permissions and re-run (prompt=consent forces a fresh token).");
    process.exit(1);
  }

  await setConnectorSecret("GOOGLE_OAUTH_REFRESH_TOKEN", data.refresh_token);
  console.log("\n✅ Google connected — Calendar + Gmail are now live in MNEMO (no restart needed).\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("connect-google failed:", e);
  process.exit(1);
});
