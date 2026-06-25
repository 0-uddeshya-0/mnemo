"use server";
import { assertOwner } from "@/lib/auth/guard";
import { hybridSearch, type SearchResult } from "@/lib/search";
import type { NodeType } from "@/lib/graph/constants";

export async function searchAction(
  query: string,
  opts?: { types?: NodeType[]; limit?: number },
): Promise<SearchResult[]> {
  await assertOwner();
  return hybridSearch(query, opts);
}

export type { SearchResult };
