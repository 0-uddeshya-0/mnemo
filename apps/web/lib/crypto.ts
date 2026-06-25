/**
 * Encryption-at-rest for `sensitivity='private'` node bodies (spec §12).
 *
 * Key = argon2id(MNEMOSYNE_PASSWORD, fixed-app-salt) → 32 bytes → AES-256-GCM.
 * The salt is a constant so the same password derives the same key across restarts
 * (this is a KDF, not password storage). Rotating MNEMOSYNE_PASSWORD or the salt makes
 * existing private ciphertext unreadable — by design.
 *
 * Ciphertext format (string, stored in `nodes.body`):  enc:v1:<base64(iv|tag|cipher)>
 */
import argon2 from "argon2";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { env, requireEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

const PREFIX = "enc:v1:";
const KDF_SALT = Buffer.from("mnemosyne-v1-kdf-salt-do-not-change", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;

let keyPromise: Promise<Buffer> | null = null;
function getKey(): Promise<Buffer> {
  if (!keyPromise) {
    const password = requireEnv("MNEMOSYNE_PASSWORD");
    keyPromise = argon2.hash(password, {
      type: argon2.argon2id,
      raw: true,
      hashLength: 32,
      salt: KDF_SALT,
      timeCost: 3,
      memoryCost: 1 << 16,
      parallelism: 1,
    }) as Promise<Buffer>;
  }
  return keyPromise;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export async function decrypt(payload: string): Promise<string> {
  if (!isEncrypted(payload)) return payload; // tolerate plaintext (legacy / mis-tagged)
  const key = await getKey();
  const buf = Buffer.from(payload.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Encrypt only if the node is private; pass through otherwise. */
export async function maybeEncryptBody(
  body: string | null,
  sensitivity: string,
): Promise<string | null> {
  if (body == null || sensitivity !== "private") return body;
  if (isEncrypted(body)) return body;
  return encrypt(body);
}

/** Decrypt a body for the authenticated owner; pass through plaintext. */
export async function maybeDecryptBody(body: string | null): Promise<string | null> {
  if (body == null || !isEncrypted(body)) return body;
  return decrypt(body);
}

const CANARY_PLAINTEXT = "mnemosyne-key-canary-v1";

/**
 * Guard against the silent data-loss trap: changing MNEMOSYNE_PASSWORD makes every existing
 * private body undecryptable. We store one canary ciphertext and, on boot, try to decrypt it.
 * Returns "ok" (key matches), "changed" (password differs → existing private data at risk —
 * surface loudly and restore from backup), or "new" (first run / no password). Never throws.
 */
export async function checkEncryptionKey(): Promise<"ok" | "changed" | "new"> {
  if (!env.MNEMOSYNE_PASSWORD) return "new"; // encryption not active without a password
  try {
    const [row] = await db
      .select({ data: appSettings.data })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    const data = (row?.data as Record<string, unknown>) ?? {};
    const stored = typeof data.keyCanary === "string" ? data.keyCanary : null;
    if (!stored) {
      const merged = { ...data, keyCanary: await encrypt(CANARY_PLAINTEXT) };
      await db
        .insert(appSettings)
        .values({ id: 1, data: merged })
        .onConflictDoUpdate({ target: appSettings.id, set: { data: merged } });
      return "new";
    }
    return (await decrypt(stored)) === CANARY_PLAINTEXT ? "ok" : "changed";
  } catch {
    return "changed"; // decrypt threw (GCM auth failure) → the key no longer matches
  }
}
