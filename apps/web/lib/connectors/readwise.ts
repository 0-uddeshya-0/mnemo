/** Readwise / Kindle: pull books + highlights via the Readwise API. */
import { enqueueIngest } from "@/lib/pipeline/ingest";
import type { AcquiredSource, PreQuote } from "@/lib/pipeline/types";
import { recordConnectorRun } from "@/lib/connectors/status";

interface ReadwiseBook {
  id: number;
  title: string;
  author?: string;
  category?: string;
  source_url?: string;
  cover_image_url?: string;
}
interface ReadwiseHighlight {
  id: number;
  text: string;
  note?: string;
  book_id: number;
}

async function fetchAll<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = `${url}?page_size=1000`;
  let guard = 0;
  while (next && guard++ < 50) {
    const res = await fetch(next, { headers: { Authorization: `Token ${token}` } });
    if (!res.ok) throw new Error(`Readwise API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { results: T[]; next: string | null };
    out.push(...data.results);
    next = data.next;
  }
  return out;
}

export async function syncReadwise(token: string): Promise<number> {
  await recordConnectorRun("readwise", "syncing…");
  const [books, highlights] = await Promise.all([
    fetchAll<ReadwiseBook>("https://readwise.io/api/v2/books/", token),
    fetchAll<ReadwiseHighlight>("https://readwise.io/api/v2/highlights/", token),
  ]);

  const byBook = new Map<number, ReadwiseHighlight[]>();
  for (const h of highlights) {
    const arr = byBook.get(h.book_id);
    if (arr) arr.push(h);
    else byBook.set(h.book_id, [h]);
  }

  let queued = 0;
  for (const book of books) {
    const hs = byBook.get(book.id) ?? [];
    if (hs.length === 0) continue;
    const quotes: PreQuote[] = hs.map((h) => ({ text: h.text, why_notable: h.note || undefined }));
    const source: AcquiredSource = {
      nodeType: book.category === "articles" ? "article" : "book",
      title: book.title,
      markdown: hs.map((h) => h.text).join("\n\n"),
      properties: {
        author: book.author,
        source: "readwise",
        url: book.source_url,
        cover: book.cover_image_url,
      },
      ownerAuthored: false,
    };
    await enqueueIngest({ kind: "connector", provider: "readwise", source, quotes });
    queued++;
  }
  await recordConnectorRun("readwise", `queued ${queued} books`);
  return queued;
}
