"use server";
import { assertOwner } from "@/lib/auth/guard";
import { syncReadwise } from "@/lib/connectors/readwise";
import {
  importBrowserSelection,
  importNotion,
  importPocket,
  importXArchive,
  parseBrowserHistory,
  type HistoryCandidate,
} from "@/lib/connectors/files";
import { listConnectorStatus, type ConnectorStatus } from "@/lib/connectors/status";

type Queued = { ok: true; queued: number } | { ok: false; error: string };

export async function listConnectorsAction(): Promise<ConnectorStatus[]> {
  await assertOwner();
  return listConnectorStatus();
}

export async function readwiseSyncAction(token: string): Promise<Queued> {
  await assertOwner();
  if (!token.trim()) return { ok: false, error: "Paste your Readwise token." };
  try {
    return { ok: true, queued: await syncReadwise(token.trim()) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function pocketImportAction(text: string): Promise<Queued> {
  await assertOwner();
  return { ok: true, queued: await importPocket(text) };
}

export async function notionImportAction(files: { name: string; content: string }[]): Promise<Queued> {
  await assertOwner();
  return { ok: true, queued: await importNotion(files) };
}

export async function xImportAction(text: string): Promise<Queued> {
  await assertOwner();
  return { ok: true, queued: await importXArchive(text) };
}

export async function browserParseAction(text: string): Promise<HistoryCandidate[]> {
  await assertOwner();
  return parseBrowserHistory(text);
}

export async function browserImportAction(urls: string[]): Promise<Queued> {
  await assertOwner();
  return { ok: true, queued: await importBrowserSelection(urls) };
}

export type { ConnectorStatus, HistoryCandidate };
