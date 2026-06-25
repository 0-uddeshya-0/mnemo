/** App settings (singleton row): agent-exposure controls (§8.7) and future prefs. */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { isLocalLLM } from "@/lib/env";
import type { NodeType } from "@/lib/graph/constants";

export interface AgentExposure {
  /** Node types never returned to agents (default hides `memory`). */
  hiddenTypes: NodeType[];
  /**
   * Whether `sensitivity='private'` nodes are exposed to agents. This is the *cloud* opt-in
   * (default false): when a cloud LLM is active it gates private access. When the model is
   * fully local, private is exposed automatically regardless (see getAgentExposure) — it
   * never leaves the Mac, so the second self can know your most defining material.
   */
  exposePrivate: boolean;
}

const DEFAULT_EXPOSURE: AgentExposure = { hiddenTypes: ["memory"], exposePrivate: false };

export interface DevSettings {
  /** Reveal advanced controls + raw agent logs in the UI. */
  developerMode: boolean;
  /** Run the proactive daily digest (08:00). Off = MNEMO only acts when asked. */
  digestEnabled: boolean;
  /** Let MNEMO end digests with a curiosity/clarifying question. */
  proactiveQuestions: boolean;
}

const DEFAULT_DEV: DevSettings = { developerMode: false, digestEnabled: true, proactiveQuestions: true };

interface SettingsData {
  agent?: Partial<AgentExposure>;
  ownerName?: string;
  dev?: Partial<DevSettings>;
}

export async function getDevSettings(): Promise<DevSettings> {
  const d = await readData();
  return { ...DEFAULT_DEV, ...(d.dev ?? {}) };
}

export async function updateDevSettings(patch: Partial<DevSettings>): Promise<DevSettings> {
  const current = await getDevSettings();
  const next = { ...current, ...patch };
  const data = await readData();
  const merged = { ...data, dev: next };
  await db
    .insert(appSettings)
    .values({ id: 1, data: merged })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: merged } });
  return next;
}

const DEFAULT_OWNER_NAME = "friend";

/** The owner's first name — used to address them across the app. Editable in Settings. */
export async function getOwnerName(): Promise<string> {
  const d = await readData();
  return (d.ownerName ?? "").trim() || DEFAULT_OWNER_NAME;
}

export async function setOwnerName(name: string): Promise<string> {
  const clean = name.trim().slice(0, 40) || DEFAULT_OWNER_NAME;
  const data = await readData();
  const merged = { ...data, ownerName: clean };
  await db
    .insert(appSettings)
    .values({ id: 1, data: merged })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: merged } });
  return clean;
}

async function readData(): Promise<SettingsData> {
  const [row] = await db
    .select({ data: appSettings.data })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  return (row?.data as SettingsData) ?? {};
}

export async function getAgentExposure(): Promise<AgentExposure> {
  const d = await readData();
  const hiddenTypes = d.agent?.hiddenTypes ?? DEFAULT_EXPOSURE.hiddenTypes;
  const storedExposePrivate = d.agent?.exposePrivate ?? DEFAULT_EXPOSURE.exposePrivate;
  // When inference is local, private content never leaves the Mac — so MNEMO may always read
  // it. Only a cloud model is gated by the explicit opt-in. This is what lets the local second
  // self learn from your most personal material without ever risking it leaving the device.
  const exposePrivate = isLocalLLM() ? true : storedExposePrivate;
  return { hiddenTypes, exposePrivate };
}

/** Whether private content is currently reachable, and why — for honest UI/telemetry. */
export async function privateExposureReason(): Promise<"local" | "cloud-opt-in" | "walled"> {
  if (isLocalLLM()) return "local";
  const d = await readData();
  return (d.agent?.exposePrivate ?? DEFAULT_EXPOSURE.exposePrivate) ? "cloud-opt-in" : "walled";
}

export async function updateAgentExposure(patch: Partial<AgentExposure>): Promise<AgentExposure> {
  const current = await getAgentExposure();
  const next: AgentExposure = { ...current, ...patch };
  const data = await readData();
  const merged = { ...data, agent: next };
  await db
    .insert(appSettings)
    .values({ id: 1, data: merged })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: merged } });
  return next;
}
