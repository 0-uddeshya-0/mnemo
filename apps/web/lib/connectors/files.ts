/** File-based connectors: Pocket export, Notion markdown, X archive, browser history. */
import { enqueueIngest } from "@/lib/pipeline/ingest";
import { recordConnectorRun } from "@/lib/connectors/status";

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

// ── Pocket / read-later export (HTML or CSV) ────────────────────────────────
export async function importPocket(text: string): Promise<number> {
  const urls = [...new Set(text.match(URL_RE) ?? [])].slice(0, 500);
  for (const url of urls) await enqueueIngest({ kind: "url", url });
  await recordConnectorRun("pocket", `queued ${urls.length} urls`);
  return urls.length;
}

// ── Notion export (one or more markdown/text files) ─────────────────────────
export async function importNotion(files: { name: string; content: string }[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    if (!f.content.trim()) continue;
    const type = f.content.length > 1500 ? "creative_work" : "note";
    await enqueueIngest({
      kind: "note",
      title: f.name.replace(/\.(md|markdown|csv|txt)$/i, ""),
      body: f.content,
      nodeType: type,
      ownerAuthored: true,
    });
    n++;
  }
  await recordConnectorRun("notion", `queued ${n} pages`);
  return n;
}

// ── X / Twitter archive (tweets.js / tweets.json) ───────────────────────────
interface TweetEntry {
  tweet?: { full_text?: string; created_at?: string };
  full_text?: string;
}

export async function importXArchive(text: string): Promise<number> {
  let jsonText = text.trim();
  if (jsonText.startsWith("window.")) {
    const eq = jsonText.indexOf("=");
    if (eq !== -1) jsonText = jsonText.slice(eq + 1).trim();
  }
  let arr: TweetEntry[];
  try {
    arr = JSON.parse(jsonText) as TweetEntry[];
  } catch {
    return 0;
  }
  const tweets = arr
    .map((x) => x.tweet?.full_text ?? x.full_text)
    .filter((t): t is string => typeof t === "string" && t.length > 0 && !t.startsWith("RT @"))
    .slice(0, 300);
  for (const full of tweets) {
    await enqueueIngest({ kind: "note", body: full, nodeType: "note", ownerAuthored: true });
  }
  await recordConnectorRun("x_archive", `queued ${tweets.length} tweets`);
  return tweets.length;
}

// ── Browser history (parse → owner selects → import) ────────────────────────
export interface HistoryCandidate {
  url: string;
  title: string;
}

export function parseBrowserHistory(text: string): HistoryCandidate[] {
  // try JSON ([{url,title}] or Chrome export {"Browser History":[...]})
  try {
    const parsed = JSON.parse(text) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { "Browser History"?: unknown[] })["Browser History"];
    if (Array.isArray(arr)) {
      return dedupe(
        arr
          .map((x) => x as { url?: string; title?: string })
          .filter((x) => x.url)
          .map((x) => ({ url: x.url!, title: (x.title || x.url)!.trim() })),
      );
    }
  } catch {
    /* not JSON; fall through */
  }
  const out: HistoryCandidate[] = [];
  const anchor = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(text))) out.push({ url: m[1]!, title: (m[2] || m[1])!.trim() });
  if (out.length === 0) {
    for (const u of text.match(URL_RE) ?? []) out.push({ url: u, title: u });
  }
  return dedupe(out);
}

function dedupe(items: HistoryCandidate[]): HistoryCandidate[] {
  const seen = new Set<string>();
  const out: HistoryCandidate[] = [];
  for (const it of items) {
    let host = it.url;
    try {
      host = new URL(it.url).hostname;
    } catch {
      /* keep raw */
    }
    const key = `${host}::${it.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 200) break;
  }
  return out;
}

export async function importBrowserSelection(urls: string[]): Promise<number> {
  for (const url of urls) await enqueueIngest({ kind: "url", url });
  await recordConnectorRun("browser", `queued ${urls.length} pages`);
  return urls.length;
}
