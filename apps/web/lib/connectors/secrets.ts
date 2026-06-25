/**
 * Connector secrets — let the owner paste tokens in-app instead of editing .env. Values are
 * stored AES-256-GCM-encrypted in app_settings and override the matching env var when present
 * (env stays a fallback). A tiny in-process cache backs the synchronous `secret()` reads the
 * connectors use; `loadSecrets()` (cheap, one row) refreshes it and is awaited at the entry
 * points (getAgentTools / connector status), so changes take effect without a restart.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

export const CONNECTOR_SECRET_KEYS = [
  "NOTION_TOKEN",
  "GITHUB_TOKEN",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
] as const;
export type ConnectorSecretKey = (typeof CONNECTOR_SECRET_KEYS)[number];

let cache: Partial<Record<ConnectorSecretKey, string>> = {};

async function readStore(): Promise<Record<string, string>> {
  const [row] = await db.select({ data: appSettings.data }).from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  const data = (row?.data as { connectorSecrets?: Record<string, string> }) ?? {};
  return data.connectorSecrets ?? {};
}

/** Refresh the in-process cache from the DB (decrypting). Cheap; call at entry points. */
export async function loadSecrets(): Promise<void> {
  const store = await readStore();
  const next: Partial<Record<ConnectorSecretKey, string>> = {};
  for (const key of CONNECTOR_SECRET_KEYS) {
    const enc = store[key];
    if (enc) {
      try {
        next[key] = await decrypt(enc);
      } catch {
        /* unreadable (password rotated) → ignore, fall back to env */
      }
    }
  }
  cache = next;
}

/** Synchronous read used by connectors: DB-stored value wins, else env, else "". */
export function secret(key: ConnectorSecretKey): string {
  return cache[key] || (env[key] as string) || "";
}

export async function setConnectorSecret(key: ConnectorSecretKey, value: string): Promise<void> {
  const store = await readStore();
  const trimmed = value.trim();
  if (trimmed) store[key] = await encrypt(trimmed);
  else delete store[key];

  const [row] = await db.select({ data: appSettings.data }).from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  const data = { ...((row?.data as Record<string, unknown>) ?? {}), connectorSecrets: store };
  await db
    .insert(appSettings)
    .values({ id: 1, data })
    .onConflictDoUpdate({ target: appSettings.id, set: { data } });
  await loadSecrets();
}
