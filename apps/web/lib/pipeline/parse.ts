/**
 * Stage 1 — Acquire & normalize. Detect input kind, parse to clean markdown + metadata,
 * decide the source node type and whether it is owner-authored (→ owner_signals).
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { AcquiredSource, RawIngestInput } from "@/lib/pipeline/types";
import type { NodeType } from "@/lib/graph/constants";

function titleFromText(text: string, fallback: string): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  const clipped = firstLine.replace(/^#+\s*/, "").slice(0, 120);
  return clipped.length >= 3 ? clipped : fallback;
}

export async function acquire(input: RawIngestInput): Promise<AcquiredSource> {
  switch (input.kind) {
    case "note": {
      const body = input.body.trim();
      return {
        nodeType: input.nodeType ?? "note",
        title: input.title?.trim() || titleFromText(body, "Untitled note"),
        markdown: body,
        properties: {},
        ownerAuthored: input.ownerAuthored ?? true,
        sensitivity: input.sensitivity,
      };
    }
    case "interview_answer": {
      return {
        nodeType: "note",
        title: `Interview · ${input.phase}`,
        markdown: `**Q:** ${input.question}\n\n**A:** ${input.answer}`,
        properties: { interviewPhase: input.phase, question: input.question },
        ownerAuthored: true,
      };
    }
    case "share": {
      if (input.url) return acquireUrl(input.url, input.text);
      const body = (input.text ?? "").trim();
      return {
        nodeType: "note",
        title: input.title?.trim() || titleFromText(body, "Shared note"),
        markdown: body,
        properties: { via: "share" },
        ownerAuthored: true,
      };
    }
    case "url":
      return acquireUrl(input.url, input.note);
    case "file":
      return acquireFile(input.path, input.filename, input.mime);
    case "connector":
      return input.source;
    default: {
      const _exhaustive: never = input;
      throw new Error(`Unknown ingest input: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

async function acquireUrl(url: string, note?: string): Promise<AcquiredSource> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; MnemosyneBot/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const title = article?.title?.trim() || dom.window.document.title || url;
  const text = (article?.textContent ?? "").trim();
  const markdown = [note?.trim(), text].filter(Boolean).join("\n\n");
  return {
    nodeType: "article",
    title,
    markdown: markdown || title,
    properties: {
      url,
      byline: article?.byline ?? undefined,
      siteName: article?.siteName ?? undefined,
      excerpt: article?.excerpt ?? undefined,
    },
    ownerAuthored: false,
  };
}

async function acquireFile(
  path: string,
  filename: string,
  mime?: string,
): Promise<AcquiredSource> {
  const buf = await readFile(path);
  const ext = extname(filename).toLowerCase();
  const baseTitle = basename(filename, ext);

  if (ext === ".pdf" || mime === "application/pdf") {
    const data = await pdfParse(buf);
    const title =
      (typeof data.info?.Title === "string" && data.info.Title.trim()) || baseTitle;
    return {
      nodeType: "paper",
      title,
      markdown: cleanText(data.text),
      properties: {
        filename,
        pages: data.numpages,
        author: typeof data.info?.Author === "string" ? data.info.Author : undefined,
      },
      ownerAuthored: false,
    };
  }

  if (ext === ".docx" || mime?.includes("officedocument.wordprocessingml")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return {
      nodeType: "note",
      title: titleFromText(value, baseTitle),
      markdown: cleanText(value),
      properties: { filename },
      ownerAuthored: false,
    };
  }

  if (ext === ".epub" || mime === "application/epub+zip") {
    return acquireEpub(path, baseTitle, filename);
  }

  // txt / md / fallback: treat as UTF-8 text.
  const text = buf.toString("utf8");
  const nodeType: NodeType = ext === ".md" || ext === ".markdown" ? "note" : "note";
  return {
    nodeType,
    title: titleFromText(text, baseTitle),
    markdown: cleanText(text),
    properties: { filename },
    ownerAuthored: false,
  };
}

interface EpubLike {
  metadata?: { title?: string; creator?: string };
  flow?: Array<{ id?: string }>;
  getChapterAsync(id: string): Promise<string>;
}

async function acquireEpub(
  path: string,
  baseTitle: string,
  filename: string,
): Promise<AcquiredSource> {
  try {
    const mod = (await import("epub2")) as unknown as {
      EPub: { createAsync(path: string): Promise<EpubLike> };
    };
    const epub = await mod.EPub.createAsync(path);
    const chapters = epub.flow ?? [];
    const parts: string[] = [];
    for (const ch of chapters) {
      if (!ch.id) continue;
      try {
        const html = await epub.getChapterAsync(ch.id);
        parts.push(stripHtml(html));
      } catch {
        /* skip unreadable chapter */
      }
    }
    return {
      nodeType: "book",
      title: epub.metadata?.title?.trim() || baseTitle,
      markdown: cleanText(parts.join("\n\n")),
      properties: { filename, author: epub.metadata?.creator },
      ownerAuthored: false,
    };
  } catch (err) {
    throw new Error(`Failed to parse EPUB ${filename}: ${(err as Error).message}`);
  }
}

function stripHtml(html: string): string {
  const dom = new JSDOM(html);
  return dom.window.document.body?.textContent ?? "";
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
