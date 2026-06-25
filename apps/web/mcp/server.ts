/**
 * Mnemosyne MCP server. Exposes the graph to MCP-capable agents (Claude Desktop, Cursor,
 * phone agents). Transports: stdio (default, local owner) and Streamable HTTP (bearer-auth'd).
 *
 *   pnpm mcp            # stdio
 *   pnpm mcp -- --http  # HTTP/SSE on MCP_HTTP_PORT
 *
 * Every read goes through agentVisibleFilter; writes are scope-gated and logged with the key.
 */
import "@/lib/server/load-env";
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { env } from "@/lib/env";
import { EDGE_TYPES, NODE_TYPES } from "@/lib/graph/constants";
import {
  agentAddKnowledge,
  agentGetNode,
  agentGraphStats,
  agentMyThemes,
  agentRecentActivity,
  agentSearch,
  agentSelfProfile,
  agentTraverse,
  agentWhatsMyViewOn,
} from "@/lib/agent/api";
import { bearerFromHeader, verifyApiKey } from "@/lib/auth/api-keys";

function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function buildServer(keyId: string | null, canWrite: boolean): McpServer {
  const server = new McpServer({ name: "mnemosyne", version: "0.1.0" });

  server.registerTool(
    "search_knowledge",
    {
      title: "Search knowledge",
      description: "Hybrid keyword + semantic search over the owner's knowledge graph.",
      inputSchema: {
        query: z.string().describe("Search query"),
        types: z.array(z.enum(NODE_TYPES)).optional().describe("Restrict to these node types"),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, types, limit }) => jsonContent(await agentSearch(query, { types, limit })),
  );

  server.registerTool(
    "get_node",
    {
      title: "Get node",
      description: "Fetch a node and its neighbors (edges carry rationales).",
      inputSchema: {
        id: z.string().describe("Node id (uuid)"),
        depth: z.number().int().min(0).max(2).optional(),
      },
    },
    async ({ id, depth }) => {
      const node = await agentGetNode(id, depth ?? 1);
      return jsonContent(node ?? { error: "not found or not visible" });
    },
  );

  server.registerTool(
    "traverse",
    {
      title: "Traverse",
      description: "Explore how a node connects outward, up to max_hops.",
      inputSchema: {
        start_id: z.string(),
        edge_types: z.array(z.enum(EDGE_TYPES)).optional(),
        max_hops: z.number().int().min(1).max(4).optional(),
      },
    },
    async ({ start_id, edge_types, max_hops }) =>
      jsonContent(await agentTraverse(start_id, { edgeTypes: edge_types, maxHops: max_hops })),
  );

  server.registerTool(
    "whats_my_view_on",
    {
      title: "What's my view on",
      description:
        "Synthesize the owner's stance on a topic from their beliefs/traits/interests, labeling any superseded views.",
      inputSchema: { topic: z.string() },
    },
    async ({ topic }) => jsonContent(await agentWhatsMyViewOn(topic)),
  );

  server.registerTool(
    "recent_activity",
    {
      title: "Recent activity",
      description: "What changed in the graph recently.",
      inputSchema: { since: z.string().optional().describe("ISO timestamp") },
    },
    async ({ since }) => jsonContent(await agentRecentActivity(since)),
  );

  server.registerTool(
    "my_themes",
    {
      title: "My themes",
      description: "The big themes (clusters) in the owner's mind — a fast way to 'get' them.",
      inputSchema: {},
    },
    async () => jsonContent(await agentMyThemes()),
  );

  if (canWrite) {
    server.registerTool(
      "add_knowledge",
      {
        title: "Add knowledge",
        description: "Write a node into the graph (confidence ≤ 0.8). Optionally link it to existing nodes.",
        inputSchema: {
          title: z.string(),
          body: z.string().optional(),
          type: z.enum(NODE_TYPES),
          links: z
            .array(z.object({ to: z.string(), type: z.enum(EDGE_TYPES) }))
            .optional(),
        },
      },
      async ({ title, body, type, links }) =>
        jsonContent(await agentAddKnowledge({ title, body, type, links }, keyId)),
    );
  }

  // Resources
  server.registerResource(
    "self-profile",
    "self://profile",
    { title: "Owner profile", description: "A short summary of who the owner is." },
    async (uri) => ({ contents: [{ uri: uri.href, text: await agentSelfProfile() }] }),
  );
  server.registerResource(
    "graph-stats",
    "graph://stats",
    { title: "Graph stats", description: "Node/edge/cluster counts." },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await agentGraphStats(), null, 2) }],
    }),
  );

  // Prompt: prime an agent to represent the owner
  server.registerPrompt(
    "represent_me",
    {
      title: "Represent me",
      description: "Primes you to answer on the owner's behalf using their graph, with guardrails.",
      argsSchema: { topic: z.string().optional() },
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "You are representing the owner of this Mnemosyne knowledge graph. Use the tools " +
              "(search_knowledge, get_node, whats_my_view_on, my_themes, traverse) to ground every claim in " +
              "their actual nodes. Prefer owner-asserted over inferred; cite node titles; flag inferences; " +
              "note when a view has changed (superseded); and NEVER invent facts or provenance. Respect that " +
              "private and hidden nodes are intentionally not available to you." +
              (topic ? `\n\nThe owner wants you to speak to: ${topic}` : ""),
          },
        },
      ],
    }),
  );

  return server;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

async function startHttp() {
  const httpServer = createServer(async (req, res) => {
    const key = bearerFromHeader(req.headers["authorization"]);
    const verified = await verifyApiKey(key, "read");
    if (!verified) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const body = await readJsonBody(req);
    const server = buildServer(verified.id, verified.scopes.includes("write"));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  httpServer.listen(env.MCP_HTTP_PORT, () => {
    console.error(`Mnemosyne MCP (HTTP) listening on :${env.MCP_HTTP_PORT}`);
  });
}

async function startStdio() {
  // stdio is local to the owner → full access, no key.
  const server = buildServer(null, true);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Mnemosyne MCP (stdio) ready.");
}

const useHttp = process.argv.includes("--http");
(useHttp ? startHttp() : startStdio()).catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
