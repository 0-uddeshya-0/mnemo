"use server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertOwner } from "@/lib/auth/guard";
import { createApiKey, deleteApiKey, listApiKeys } from "@/lib/auth/api-keys";
import {
  getAgentExposure,
  updateAgentExposure,
  updateDevSettings,
  type AgentExposure,
  type DevSettings,
} from "@/lib/settings";
import { db } from "@/lib/db";
import { activityLog, apiKeys } from "@/lib/db/schema";
import { API_SCOPES, NODE_TYPES } from "@/lib/graph/constants";
import { connectorStatus, type ConnectorStatus } from "@/lib/connectors";
import { setConnectorSecret, CONNECTOR_SECRET_KEYS, type ConnectorSecretKey } from "@/lib/connectors/secrets";
import {
  listAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  runAutomationNow,
  type Automation,
  type AutomationInput,
} from "@/lib/automations";

export interface ApiKeyView {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export async function listApiKeysAction(): Promise<ApiKeyView[]> {
  await assertOwner();
  const rows = await listApiKeys();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scopes: r.scopes ?? [],
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

const CreateSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

export async function createApiKeyAction(
  input: z.infer<typeof CreateSchema>,
): Promise<{ ok: true; id: string; key: string } | { ok: false; error: string }> {
  await assertOwner();
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid key request." };
  const { id, key } = await createApiKey(parsed.data.name, parsed.data.scopes);
  return { ok: true, id, key };
}

export async function deleteApiKeyAction(id: string): Promise<{ ok: true }> {
  await assertOwner();
  await deleteApiKey(id);
  return { ok: true };
}

export async function getExposureAction(): Promise<AgentExposure> {
  await assertOwner();
  return getAgentExposure();
}

const ExposureSchema = z.object({
  hiddenTypes: z.array(z.enum(NODE_TYPES)).optional(),
  exposePrivate: z.boolean().optional(),
});

export async function updateExposureAction(
  patch: z.infer<typeof ExposureSchema>,
): Promise<AgentExposure> {
  await assertOwner();
  return updateAgentExposure(ExposureSchema.parse(patch));
}

/** Save (or clear, if empty) a connector token — encrypted at rest. Returns fresh status. */
export async function saveConnectorSecretsAction(
  values: Partial<Record<ConnectorSecretKey, string>>,
): Promise<ConnectorStatus[]> {
  await assertOwner();
  for (const key of CONNECTOR_SECRET_KEYS) {
    if (key in values) await setConnectorSecret(key, values[key] ?? "");
  }
  return connectorStatus();
}

export async function updateDevSettingsAction(patch: Partial<DevSettings>): Promise<DevSettings> {
  await assertOwner();
  return updateDevSettings(patch);
}

// ── Automations (owner-defined recurring agent tasks) ────────────────────────
export async function listAutomationsAction(): Promise<Automation[]> {
  await assertOwner();
  return listAutomations();
}
export async function createAutomationAction(input: AutomationInput): Promise<Automation[]> {
  await assertOwner();
  await createAutomation(input);
  return listAutomations();
}
export async function updateAutomationAction(
  id: string,
  patch: Partial<AutomationInput & { enabled: boolean }>,
): Promise<Automation[]> {
  await assertOwner();
  await updateAutomation(id, patch);
  return listAutomations();
}
export async function deleteAutomationAction(id: string): Promise<Automation[]> {
  await assertOwner();
  await deleteAutomation(id);
  return listAutomations();
}
export async function runAutomationNowAction(id: string): Promise<{ ok: true }> {
  await assertOwner();
  await runAutomationNow(id);
  return { ok: true };
}

export interface AgentLogEntry {
  action: string;
  keyName: string | null;
  at: string;
}

export async function getAgentLogAction(): Promise<AgentLogEntry[]> {
  await assertOwner();
  const rows = await db
    .select({
      action: activityLog.action,
      at: activityLog.at,
      keyName: apiKeys.name,
    })
    .from(activityLog)
    .leftJoin(apiKeys, eq(activityLog.actorKeyId, apiKeys.id))
    .where(eq(activityLog.actor, "agent"))
    .orderBy(desc(activityLog.at))
    .limit(30);
  return rows.map((r) => ({ action: r.action, keyName: r.keyName, at: r.at.toISOString() }));
}

export type { Automation, AutomationInput };
