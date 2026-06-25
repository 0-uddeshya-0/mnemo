/**
 * Bearer API keys for agent/REST access. Keys are shown once, stored argon2-hashed.
 * Verification iterates keys (single-user → a handful) and argon2-verifies each.
 */
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import type { ApiScope } from "@/lib/graph/constants";

const KEY_PREFIX = "mnem_";

export function generateRawKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export async function createApiKey(
  name: string,
  scopes: ApiScope[],
): Promise<{ id: string; key: string }> {
  const key = generateRawKey();
  const keyHash = await argon2.hash(key, { type: argon2.argon2id });
  const [row] = await db
    .insert(apiKeys)
    .values({ name, keyHash, scopes })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error("Failed to create API key");
  return { id: row.id, key };
}

export interface VerifiedKey {
  id: string;
  name: string;
  scopes: ApiScope[];
}

/** Returns the verified key (and optionally enforces a scope), or null if invalid. */
export async function verifyApiKey(
  presented: string | null | undefined,
  requiredScope?: ApiScope,
): Promise<VerifiedKey | null> {
  if (!presented || !presented.startsWith(KEY_PREFIX)) return null;
  const rows = await db.select().from(apiKeys);
  for (const row of rows) {
    let ok = false;
    try {
      ok = await argon2.verify(row.keyHash, presented);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    const scopes = (row.scopes ?? []) as ApiScope[];
    if (requiredScope && !scopes.includes(requiredScope)) return null;
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    return { id: row.id, name: row.name, scopes };
  }
  return null;
}

export async function listApiKeys() {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(apiKeys.createdAt);
}

export async function deleteApiKey(id: string): Promise<void> {
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
}

/** Extract a bearer token from an Authorization header. */
export function bearerFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}
