/**
 * Archive parsers — turn an exported file (WhatsApp chat, X/Twitter archive, Claude export,
 * Google Keep note, or a plain journal) into a normalized list of dated text items. Format
 * is auto-detected from the filename + contents. Best-effort: unknown shapes fall back to
 * "treat the readable text as a journal". No external deps.
 */

export interface ImportItem {
  date?: string; // ISO date if we could find one
  text: string;
  author?: string; // for chats — whose line it is
}

export type ArchiveKind = "whatsapp" | "twitter" | "claude" | "keep" | "journal";

export interface ParsedArchive {
  kind: ArchiveKind;
  items: ImportItem[];
}

export function parseArchive(filename: string, content: string): ParsedArchive {
  const name = filename.toLowerCase();
  const head = content.slice(0, 2000);

  if (/^window\.YTD\.tweets?\b/.test(content.trimStart()) || name.includes("tweets.js") || name.includes("tweet.js")) {
    return { kind: "twitter", items: parseTwitter(content) };
  }
  if (name.includes("conversations.json") || /"sender"\s*:\s*"(human|assistant)"/.test(head) || /"chat_messages"/.test(head)) {
    return { kind: "claude", items: parseClaude(content) };
  }
  if (name.endsWith(".json") && /"textContent"|"isTrashed"|"userEditedTimestampUsec"/.test(head)) {
    return { kind: "keep", items: parseKeep(content) };
  }
  if (isWhatsApp(content)) {
    return { kind: "whatsapp", items: parseWhatsApp(content) };
  }
  if (name.endsWith(".json")) {
    return { kind: "journal", items: parseGenericJson(content) };
  }
  return { kind: "journal", items: parseJournal(content) };
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
const WA_LINE =
  /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([AaPp][Mm])?\]?\s*[-–]?\s*([^:]{1,40}?):\s?(.*)$/;

function isWhatsApp(content: string): boolean {
  return content.split("\n").slice(0, 12).some((l) => WA_LINE.test(l.trim()));
}

function parseWhatsApp(content: string): ImportItem[] {
  const items: ImportItem[] = [];
  let cur: ImportItem | null = null;
  for (const raw of content.split("\n")) {
    const m = raw.trim().match(WA_LINE);
    if (m) {
      if (cur) items.push(cur);
      const text = m[5] ?? "";
      // skip WhatsApp system lines
      if (/Messages and calls are end-to-end encrypted|<Media omitted>|changed the subject|added you/i.test(text)) {
        cur = null;
        continue;
      }
      cur = { date: normalizeDate(m[1]!), author: m[4]?.trim(), text };
    } else if (cur && raw.trim()) {
      cur.text += "\n" + raw.trim();
    }
  }
  if (cur) items.push(cur);
  return items;
}

// ── X / Twitter archive (tweets.js) ──────────────────────────────────────────
function parseTwitter(content: string): ImportItem[] {
  const json = content.replace(/^\s*window\.YTD\.tweets?\.part\d+\s*=\s*/, "");
  let arr: any[];
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  const items: ImportItem[] = [];
  for (const row of arr) {
    const t = row.tweet ?? row;
    const text: string = t.full_text ?? t.text ?? "";
    if (!text || text.startsWith("RT @")) continue; // skip retweets
    items.push({ date: t.created_at ? new Date(t.created_at).toISOString() : undefined, text });
  }
  return items;
}

// ── Claude export (conversations.json) — keep the OWNER's messages ────────────
function parseClaude(content: string): ImportItem[] {
  let data: any;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const convos = Array.isArray(data) ? data : data.conversations ?? [];
  const items: ImportItem[] = [];
  for (const c of convos) {
    const msgs = c.chat_messages ?? c.messages ?? [];
    for (const m of msgs) {
      if ((m.sender ?? m.role) !== "human" && (m.sender ?? m.role) !== "user") continue;
      const text = typeof m.text === "string" ? m.text : extractText(m.content);
      if (text) items.push({ date: m.created_at ? new Date(m.created_at).toISOString() : undefined, text });
    }
  }
  return items;
}

// ── Google Keep note ─────────────────────────────────────────────────────────
function parseKeep(content: string): ImportItem[] {
  try {
    const n = JSON.parse(content);
    const text = [n.title, n.textContent].filter(Boolean).join("\n").trim();
    if (!text || n.isTrashed) return [];
    const date = n.userEditedTimestampUsec ? new Date(Number(n.userEditedTimestampUsec) / 1000).toISOString() : undefined;
    return [{ date, text }];
  } catch {
    return [];
  }
}

// ── Generic JSON — walk for text-bearing fields ──────────────────────────────
function parseGenericJson(content: string): ImportItem[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return parseJournal(content);
  }
  const items: ImportItem[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "string" && v.trim().length > 40) items.push({ text: v.trim() });
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(data);
  return items;
}

// ── Plain journal / markdown ─────────────────────────────────────────────────
function parseJournal(content: string): ImportItem[] {
  // Split on blank lines or markdown date headers; keep paragraphs of substance.
  const blocks = content.split(/\n{2,}/);
  const items: ImportItem[] = [];
  let curDate: string | undefined;
  for (const b of blocks) {
    const trimmed = b.trim();
    if (!trimmed) continue;
    const dateMatch = trimmed.match(/^#{0,3}\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
    if (dateMatch) curDate = normalizeDate(dateMatch[1]!);
    items.push({ date: curDate, text: trimmed });
  }
  return items;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function normalizeDate(s: string): string | undefined {
  // handle DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD — best effort, return ISO date
  const parts = s.split(/[/.-]/).map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return undefined;
  let [a, b, c] = parts as [number, number, number];
  if (a > 31) {
    // YYYY-MM-DD
    return safeISO(a, b, c);
  }
  if (c < 100) c += 2000;
  // assume DD/MM/YYYY (most of the world / WhatsApp default)
  return safeISO(c, b, a);
}

function safeISO(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return isNaN(dt.getTime()) ? undefined : dt.toISOString().slice(0, 10);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c?.text ?? "")).join(" ").trim();
  return "";
}
