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

export async function fetchWeb(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  return {
    title: article?.title?.trim() || dom.window.document.title || url,
    text: (article?.textContent ?? "").trim().slice(0, 6000),
  };
}
