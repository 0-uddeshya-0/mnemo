/**
 * The agent's window to the web — free, no API key. searchWeb uses DuckDuckGo's HTML
 * endpoint; fetchWeb pulls a page and extracts readable text via Readability. Best-effort
 * (DDG may throttle); failures degrade to an empty result, never throw the agent loop.
 */
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** DuckDuckGo time filters: past day / week / month / year. */
export type Recency = "d" | "w" | "m" | "y";

export async function searchWeb(
  query: string,
  limit = 5,
  opts: { recency?: Recency } = {},
): Promise<WebResult[]> {
  try {
    const df = opts.recency ? `&df=${opts.recency}` : "";
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${df}`, {
      headers: { "user-agent": UA },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const dom = new JSDOM(html);
    const out: WebResult[] = [];
    for (const el of dom.window.document.querySelectorAll(".result__body, .web-result")) {
      const a = el.querySelector("a.result__a") as HTMLAnchorElement | null;
      if (!a) continue;
      const snippet = el.querySelector(".result__snippet")?.textContent?.trim() ?? "";
      out.push({ title: a.textContent?.trim() ?? "", url: decodeDdgUrl(a.href), snippet });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

function decodeDdgUrl(href: string): string {
  // DDG wraps links as //duckduckgo.com/l/?uddg=<encoded>
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

/**
 * Reject anything that is not a public http(s) destination. The agent picks these
 * URLs from model output and from fetched page content, so without this an
 * injected link could make the agent read loopback services (the content-engine
 * dashboard, the MCP HTTP port) or cloud metadata and paste the response into the graph.
 */
function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`refusing to fetch: not a URL (${raw.slice(0, 80)})`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`refusing to fetch: ${u.protocol} is not http(s)`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host);
  if (isPrivate) throw new Error(`refusing to fetch private/loopback address: ${host}`);
  return u;
}

export async function fetchWeb(url: string): Promise<{ title: string; text: string }> {
  assertPublicHttpUrl(url);
  // Manual redirects: every hop is re-checked, so a public URL cannot bounce to loopback.
  let current = url;
  let res: Response | undefined;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(current, { headers: { "user-agent": UA }, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = assertPublicHttpUrl(new URL(loc, current).toString()).toString();
      continue;
    }
    break;
  }
  if (!res) throw new Error(`fetch ${url} → no response`);
  if (res.status >= 300 && res.status < 400) throw new Error(`fetch ${url} → too many redirects`);
  if (!res.ok) throw new Error(`fetch ${current} → HTTP ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  return {
    title: article?.title?.trim() || dom.window.document.title || url,
    text: (article?.textContent ?? "").trim().slice(0, 6000),
  };
}
