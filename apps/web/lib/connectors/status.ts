/** Connector bookkeeping (idempotent re-syncs): status + last_run_at + cursor per provider. */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { connectors } from "@/lib/db/schema";
import { CONNECTOR_PROVIDERS, type ConnectorProvider } from "@/lib/graph/constants";

export interface ConnectorStatus {
  provider: ConnectorProvider;
  status: string;
  lastRunAt: string | null;
}

export async function listConnectorStatus(): Promise<ConnectorStatus[]> {
  const rows = await db.select().from(connectors);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return CONNECTOR_PROVIDERS.map((p) => {
    const r = byProvider.get(p);
    return {
      provider: p,
      status: r?.status ?? "idle",
      lastRunAt: r?.lastRunAt ? r.lastRunAt.toISOString() : null,
    };
  });
}

export async function recordConnectorRun(
  provider: ConnectorProvider,
  status: string,
  cursor?: Record<string, unknown>,
): Promise<void> {
  const [existing] = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(eq(connectors.provider, provider))
    .limit(1);
  if (existing) {
    await db
      .update(connectors)
      .set({ status, lastRunAt: new Date(), ...(cursor ? { cursor } : {}) })
      .where(eq(connectors.id, existing.id));
  } else {
    await db.insert(connectors).values({ provider, status, lastRunAt: new Date(), cursor: cursor ?? {} });
  }
}
