/**
 * agentVisibleFilter — the SINGLE choke point that decides what agents may see. Every
 * MCP/REST read path runs its candidate nodes through `isVisible` / `filterVisible`.
 * Private nodes and owner-hidden types never leave, regardless of key scope (§12).
 */
import { getAgentExposure, type AgentExposure } from "@/lib/settings";
import type { NodeType } from "@/lib/graph/constants";

export type Visibility = AgentExposure;

export interface VisibilityNode {
  type: NodeType;
  sensitivity: string;
  status?: string;
}

export async function getVisibility(): Promise<Visibility> {
  return getAgentExposure();
}

export function isVisible(node: VisibilityNode, v: Visibility): boolean {
  if (node.sensitivity === "private" && !v.exposePrivate) return false;
  if (v.hiddenTypes.includes(node.type)) return false;
  return true;
}

export function filterVisible<T extends VisibilityNode>(nodes: T[], v: Visibility): T[] {
  return nodes.filter((n) => isVisible(n, v));
}
