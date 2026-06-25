/**
 * Google connector — Calendar + Gmail, MNEMO's senses + hands for the user's day. Uses a
 * stored OAuth refresh token (set up once via `pnpm connect:google`) to mint short-lived
 * access tokens. Reads are senses; writes (create event, draft email) are surfaced to the
 * agent as proposals (ask-before-acting). REST via fetch, no SDK. Tokens never leave the Mac.
 */
import { secret } from "@/lib/connectors/secrets";

export function googleConfigured(): boolean {
  return (
    secret("GOOGLE_OAUTH_CLIENT_ID").length > 0 &&
    secret("GOOGLE_OAUTH_CLIENT_SECRET").length > 0 &&
    secret("GOOGLE_OAUTH_REFRESH_TOKEN").length > 0
  );
}

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 30_000) return cachedToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: secret("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: secret("GOOGLE_OAUTH_CLIENT_SECRET"),
      refresh_token: secret("GOOGLE_OAUTH_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function gapi(url: string, init: RequestInit = {}): Promise<unknown> {
  const token = await accessToken();
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── Calendar ─────────────────────────────────────────────────────────────────
export interface CalEvent {
  summary: string;
  start: string;
  end: string;
  location?: string;
}

export async function calendarUpcoming(maxResults = 10): Promise<CalEvent[]> {
  const now = new Date().toISOString();
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    new URLSearchParams({ timeMin: now, singleEvents: "true", orderBy: "startTime", maxResults: String(maxResults) });
  const data = (await gapi(url)) as { items?: Array<Record<string, any>> };
  return (data.items ?? []).map((e) => ({
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location,
  }));
}

export async function calendarCreateEvent(input: {
  summary: string;
  startISO: string;
  endISO: string;
  description?: string;
  location?: string;
}): Promise<{ htmlLink: string }> {
  const data = (await gapi("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.startISO },
      end: { dateTime: input.endISO },
    }),
  })) as { htmlLink?: string };
  return { htmlLink: String(data.htmlLink ?? "") };
}

// ── Gmail ────────────────────────────────────────────────────────────────────
export interface MailHit {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
}

export async function gmailSearch(query: string, limit = 8): Promise<MailHit[]> {
  const list = (await gapi(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?` +
      new URLSearchParams({ q: query, maxResults: String(limit) }),
  )) as { messages?: { id: string }[] };
  const hits: MailHit[] = [];
  for (const m of list.messages ?? []) {
    const msg = (await gapi(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&` +
        new URLSearchParams({ metadataHeaders: "From" }) + "&metadataHeaders=Subject&metadataHeaders=Date",
    )) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
    const h = (n: string) => msg.payload?.headers?.find((x) => x.name === n)?.value ?? "";
    hits.push({ id: m.id, from: h("From"), subject: h("Subject"), snippet: msg.snippet ?? "", date: h("Date") });
  }
  return hits;
}

export async function gmailReadMessage(id: string): Promise<string> {
  const msg = (await gapi(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
  )) as { payload?: any; snippet?: string };
  const parts: any[] = [];
  const walk = (p: any) => {
    if (!p) return;
    if (p.body?.data) parts.push(p);
    (p.parts ?? []).forEach(walk);
  };
  walk(msg.payload);
  const textPart = parts.find((p) => p.mimeType === "text/plain") ?? parts[0];
  if (textPart?.body?.data) {
    const buf = Buffer.from(textPart.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return buf.toString("utf8").slice(0, 4000);
  }
  return msg.snippet ?? "(no readable body)";
}

/** Create a DRAFT (never auto-sends). Returns the draft id. */
export async function gmailCreateDraft(input: { to: string; subject: string; body: string }): Promise<{ id: string }> {
  const raw = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.body,
  ].join("\r\n");
  const encoded = Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const data = (await gapi("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw: encoded } }),
  })) as { id?: string };
  return { id: String(data.id ?? "") };
}
