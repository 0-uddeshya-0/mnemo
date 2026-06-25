import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: { title: "Mnemosyne API", version: "0.1.0", description: "Personal knowledge graph API." },
    servers: [{ url: env.APP_URL }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "Mnemosyne API key (mnem_…)" },
      },
    },
    security: [{ bearer: [] }],
    paths: {
      "/api/search": {
        get: {
          summary: "Hybrid search",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "types", in: "query", schema: { type: "string" }, description: "comma-separated node types" },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Ranked nodes" } },
        },
      },
      "/api/nodes/{id}": {
        get: {
          summary: "Get node + neighbors",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "depth", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Node detail" }, "404": { description: "Not found / not visible" } },
        },
      },
      "/api/nodes": {
        post: {
          summary: "Add knowledge (scope: write)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "type"],
                  properties: {
                    title: { type: "string" },
                    body: { type: "string" },
                    type: { type: "string" },
                    links: {
                      type: "array",
                      items: { type: "object", properties: { to: { type: "string" }, type: { type: "string" } } },
                    },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
      "/api/traverse": {
        get: {
          summary: "Traverse from a node",
          parameters: [
            { name: "start_id", in: "query", required: true, schema: { type: "string" } },
            { name: "edge_types", in: "query", schema: { type: "string" } },
            { name: "max_hops", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Reachable nodes" } },
        },
      },
      "/api/activity": {
        get: {
          summary: "Recent activity",
          parameters: [{ name: "since", in: "query", schema: { type: "string", format: "date-time" } }],
          responses: { "200": { description: "Activity log" } },
        },
      },
      "/api/themes": {
        get: { summary: "Theme clusters", responses: { "200": { description: "Clusters" } } },
      },
    },
  };
  return NextResponse.json(spec);
}
