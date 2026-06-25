import { AgentChat } from "@/components/agent/agent-chat";
import { getOwnerName } from "@/lib/settings";

export default async function AgentPage() {
  const ownerName = await getOwnerName();
  return <AgentChat ownerName={ownerName} />;
}
