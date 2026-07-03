import { resolve } from "node:path";
import { env } from "@/lib/env";
import { AgentsSettings } from "@/components/settings/agents-settings";
import { connectorStatus } from "@/lib/connectors";
import { getDevSettings } from "@/lib/settings";
import { getVaultSettings } from "@/lib/settings";
import { getAgentLogAction, getExposureAction, listApiKeysAction, listAutomationsAction } from "./actions";

export default async function AgentsSettingsPage() {
  const [keys, exposure, log, connectors, dev, automations, vault] = await Promise.all([
    listApiKeysAction(),
    getExposureAction(),
    getAgentLogAction(),
    connectorStatus(),
    getDevSettings(),
    listAutomationsAction(),
    getVaultSettings(),
  ]);
  const repoRoot = resolve(process.cwd(), "../..");
  return (
    <AgentsSettings
      initialKeys={keys}
      initialExposure={exposure}
      initialLog={log}
      connectors={connectors}
      dev={dev}
      automations={automations}
      vault={vault}
      repoRoot={repoRoot}
      httpPort={env.MCP_HTTP_PORT}
      appUrl={env.APP_URL}
    />
  );
}
