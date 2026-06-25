/**
 * The agent's tools. READ tools run freely inside the loop; WRITE/EXTERNAL tools are never
 * executed by the agent itself — the runtime turns them into proposals the owner approves.
 * All graph reads go through the agent API (private + hidden nodes are already filtered out,
 * so nothing sensitive reaches the cloud model).
 */
import {
  agentAddKnowledge,
  agentGetNode,
  agentMyThemes,
  agentRecallConversations,
  agentRecentActivity,
  agentSearch,
  agentTraverse,
  agentWhatsMyViewOn,
} from "@/lib/agent/api";
import { upsertEdge } from "@/lib/graph/store";
import { searchWeb, fetchWeb } from "@/lib/agent/web";
import { connectorTools } from "@/lib/connectors";
import { loadSecrets } from "@/lib/connectors/secrets";
import { EDGE_TYPES, NODE_TYPES, type EdgeType, type NodeType } from "@/lib/graph/constants";

export type ToolTier = "read" | "write" | "external";

export interface AgentTool {
  name: string;
  tier: ToolTier;
  description: string;
  run(args: Record<string, unknown>): Promise<string>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const asNodeType = (v: unknown): NodeType =>
  (NODE_TYPES as readonly string[]).includes(str(v)) ? (str(v) as NodeType) : "note";
const asEdgeType = (v: unknown): EdgeType =>
  (EDGE_TYPES as readonly string[]).includes(str(v)) ? (str(v) as EdgeType) : "relates_to";

const BASE_TOOLS: AgentTool[] = [
  {
    name: "search_my_knowledge",
    tier: "read",
    description: "search_my_knowledge(query: string, limit?: number) — hybrid search the owner's knowledge graph.",
    run: async (a) => JSON.stringify(await agentSearch(str(a.query), { limit: Number(a.limit) || 8 })),
  },
  {
    name: "get_node",
    tier: "read",
    description: "get_node(id: string) — a node with its neighbors and the edges (with rationales).",
    run: async (a) => JSON.stringify((await agentGetNode(str(a.id))) ?? { error: "not found" }),
  },
  {
    name: "traverse",
    tier: "read",
    description: "traverse(start_id: string, max_hops?: number) — explore what connects to a node.",
    run: async (a) => JSON.stringify(await agentTraverse(str(a.start_id), { maxHops: Number(a.max_hops) || 2 })),
  },
  {
    name: "my_view_on",
    tier: "read",
    description: "my_view_on(topic: string) — synthesize the owner's stance on a topic from their own beliefs.",
    run: async (a) => JSON.stringify(await agentWhatsMyViewOn(str(a.topic))),
  },
  {
    name: "my_themes",
    tier: "read",
    description: "my_themes() — the big themes (clusters) in the owner's mind.",
    run: async () => JSON.stringify(await agentMyThemes()),
  },
  {
    name: "recent_activity",
    tier: "read",
    description: "recent_activity(limit?: number) — what was recently added or changed in the brain (use this to find what's new).",
    run: async (a) => JSON.stringify(await agentRecentActivity(undefined, Number(a.limit) || 30)),
  },
  {
    name: "recall_conversations",
    tier: "read",
    description:
      "recall_conversations(query: string, limit?: number) — MNEMO's episodic memory: recall what you and the owner actually discussed in PAST conversations (question + answer, most recent first). Use it for continuity ('what did we talk about…', 'last time you said…', following up on an earlier thread).",
    run: async (a) =>
      JSON.stringify(await agentRecallConversations(str(a.query), Number(a.limit) || 5)),
  },
  {
    name: "web_search",
    tier: "read",
    description: "web_search(query: string) — search the public web (read-only) for understanding.",
    run: async (a) => JSON.stringify(await searchWeb(str(a.query), 5)),
  },
  {
    name: "web_fetch",
    tier: "read",
    description: "web_fetch(url: string) — read the main text of a web page.",
    run: async (a) => {
      const r = await fetchWeb(str(a.url));
      return `# ${r.title}\n${r.text}`;
    },
  },
  {
    name: "research_recent",
    tier: "read",
    description:
      "research_recent(topic: string) — what's being said about a topic RECENTLY (past ~month) across the public web: fresh discussion, trends, current sentiment. Use for 'what's new / what are people saying lately', NOT for timeless facts (use web_search for those).",
    run: async (a) => {
      const topic = str(a.topic) || str(a.query);
      const hits = await searchWeb(topic, 6, { recency: "m" });
      if (hits.length === 0) return JSON.stringify({ topic, note: "no recent results found", sources: [] });
      // Pull substance from the top couple of sources so the synthesis is grounded, not just titles.
      const excerpts: { title: string; url: string; text: string }[] = [];
      for (const h of hits.slice(0, 3)) {
        try {
          const p = await fetchWeb(h.url);
          excerpts.push({ title: p.title, url: h.url, text: p.text.slice(0, 1400) });
        } catch {
          /* skip unreachable source */
        }
      }
      return JSON.stringify({ topic, window: "past ~30 days", sources: hits, excerpts });
    },
  },
  {
    name: "add_knowledge",
    tier: "write",
    description: `add_knowledge(title: string, body: string, type: one of [${NODE_TYPES.join(", ")}]) — add a new node to the owner's brain.`,
    run: async (a) => {
      const { id } = await agentAddKnowledge(
        { title: str(a.title), body: str(a.body), type: asNodeType(a.type) },
        null,
      );
      return `added node ${id}`;
    },
  },
  {
    name: "link_nodes",
    tier: "write",
    description: `link_nodes(src_id: string, dst_id: string, type: one of [${EDGE_TYPES.join(", ")}], rationale: string) — connect two existing nodes.`,
    run: async (a) => {
      await upsertEdge({
        src: str(a.src_id),
        dst: str(a.dst_id),
        type: asEdgeType(a.type),
        weight: 0.6,
        confidence: 0.7,
        rationale: str(a.rationale) || "Linked by MNEMO.",
      });
      return "linked";
    },
  },
];

/** All tools available right now = the built-ins plus any *configured* connectors.
 * Async because it refreshes connector secrets (so a token saved in Settings takes effect
 * without a restart). */
export async function getAgentTools(): Promise<AgentTool[]> {
  await loadSecrets();
  return [...BASE_TOOLS, ...connectorTools()];
}

export function findTool(tools: AgentTool[], name: string): AgentTool | undefined {
  return tools.find((t) => t.name === name);
}

export function toolsManifest(tools: AgentTool[]): string {
  return tools.map((t) => `- ${t.description} [${t.tier}]`).join("\n");
}
