/** Shared bearer-auth, in-memory rate limiting, and audit logging for the REST API. */
import { NextResponse } from "next/server";
import { bearerFromHeader, verifyApiKey } from "@/lib/auth/api-keys";
import { recordActivity } from "@/lib/graph/store";
import type { ApiScope } from "@/lib/graph/constants";

const RATE_LIMIT = 120;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; reset: number }>();

export interface AuthedKey {
  keyId: string;
  scopes: ApiScope[];
}

export async function authorize(req: Request, scope: ApiScope): Promise<AuthedKey | Response> {
  const key = bearerFromHeader(req.headers.get("authorization"));
  const verified = await verifyApiKey(key, scope);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = Date.now();
  const bucket = buckets.get(verified.id);
  if (!bucket || bucket.reset < now) {
    buckets.set(verified.id, { count: 1, reset: now + WINDOW_MS });
  } else {
    bucket.count++;
    if (bucket.count > RATE_LIMIT) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  }
  return { keyId: verified.id, scopes: verified.scopes };
}

export async function audit(
  keyId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await recordActivity({ action, actor: "agent", actorKeyId: keyId, detail });
}
