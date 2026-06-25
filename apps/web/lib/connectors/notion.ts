/**
 * Notion connector — one of MNEMO's senses + hands. Token-based (an internal integration
 * token in NOTION_TOKEN); no OAuth dance. Reads search/pages; writes are surfaced to the
 * agent as proposals (ask-before-acting), never executed silently. REST via fetch, no SDK.
 */
import { secret } from "@/lib/connectors/secrets";

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

export function notionConfigured(): boolean {
  return secret("NOTION_TOKEN").length > 0;
}

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${secret("NOTION_TOKEN")}`,
    "notion-version": VERSION,
    "content-type": "application/json",
  };
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function plainTitle(props: Record<string, unknown> | undefined): string {
  if (!props) return "(untitled)";
  for (const v of Object.values(props)) {
    const t = (v as { type?: string; title?: { plain_text?: string }[] });
    if (t?.type === "title") return t.title?.map((x) => x.plain_text).join("") || "(untitled)";
  }
  return "(untitled)";
}

export interface NotionHit {
  id: string;
  title: string;
  url: string;
  type: "page" | "database";
  edited: string;
}

export async function notionSearch(query: string, limit = 8): Promise<NotionHit[]> {
  const data = (await call("/search", {
    method: "POST",
    body: JSON.stringify({ query, page_size: limit, sort: { direction: "descending", timestamp: "last_edited_time" } }),
  })) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? []).map((r) => ({
    id: String(r.id),
    title: r.object === "database"
      ? ((r.title as { plain_text?: string }[] | undefined)?.map((x) => x.plain_text).join("") || "(untitled db)")
      : plainTitle(r.properties as Record<string, unknown>),
    url: String(r.url ?? ""),
    type: (r.object === "database" ? "database" : "page"),
    edited: String(r.last_edited_time ?? ""),
  }));
}

/** Read a page's text content (top-level blocks, flattened). */
export async function notionReadPage(pageId: string): Promise<string> {
  const data = (await call(`/blocks/${pageId}/children?page_size=100`)) as {
    results?: Array<Record<string, any>>;
  };
  const lines: string[] = [];
  for (const b of data.results ?? []) {
    const rt = b[b.type]?.rich_text as { plain_text?: string }[] | undefined;
    const text = rt?.map((x) => x.plain_text).join("") ?? "";
    if (text) lines.push(text);
  }
  return lines.join("\n").slice(0, 4000) || "(no readable text on this page)";
}

/** Create a new page (under a parent page id). Returns the new page url. */
export async function notionCreatePage(input: {
  parentPageId: string;
  title: string;
  content?: string;
}): Promise<{ url: string }> {
  const children = (input.content ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: line.slice(0, 2000) } }] },
    }));
  const data = (await call("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { page_id: input.parentPageId },
      properties: { title: { title: [{ type: "text", text: { content: input.title } }] } },
      children,
    }),
  })) as { url?: string };
  return { url: String(data.url ?? "") };
}

/** Append a paragraph to an existing page. */
export async function notionAppend(pageId: string, text: string): Promise<void> {
  await call(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: JSON.stringify({
      children: [
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }] } },
      ],
    }),
  });
}
