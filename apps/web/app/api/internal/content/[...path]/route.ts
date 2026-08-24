/**
 * Server-side proxy to the content-engine's local dashboard API (that server sets no
 * CORS headers, so every browser call routes through here instead). Owner-session only.
 * Only ever forwards the matched path segments — never an absolute URL supplied by the
 * client — and rejects any segment containing "..". Binary responses (zips from
 * /api/ig-zip, images from /asset/*) stream through with their original content-type
 * and content-disposition; JSON responses pass through unchanged.
 */
import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";
import { env } from "@/lib/env";

const TIMEOUT_MS = 5000;

async function proxy(req: Request, path: string[]): Promise<Response> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (path.length === 0 || path.some((segment) => segment.includes(".."))) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const { search } = new URL(req.url);
  const target = `${env.CONTENT_ENGINE_URL}/${path.map(encodeURIComponent).join("/")}${search}`;

  const init: RequestInit = { method: req.method, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (req.method === "POST") {
    init.body = await req.text();
    init.headers = { "content-type": "application/json" };
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return NextResponse.json({ error: "content-engine offline" }, { status: 503 });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentDisposition = upstream.headers.get("content-disposition");
  if (contentType) headers.set("content-type", contentType);
  if (contentDisposition) headers.set("content-disposition", contentDisposition);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}
