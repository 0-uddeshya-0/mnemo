/**
 * Next.js config. PWA wrapping (manifest/service-worker/share-target) is layered
 * on in phase 8 via @ducanh2912/next-pwa around this base config.
 *
 * Native/heavy server-only deps are marked external so Next never tries to bundle
 * them for the browser or edge runtime.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Monorepo root (two levels up from apps/web). Pins Next's file-tracing + silences the
// "multiple lockfiles" root-inference warning caused by stray lockfiles in $HOME.
const monorepoRoot = resolve(process.cwd(), "../..");

// Honor the single repo-root .env (also read by docker-compose) for the Next server.
for (const candidate of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* ignore */
    }
    break;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: monorepoRoot,
  serverExternalPackages: [
    "argon2",
    "pg-boss",
    "postgres",
    "pdf-parse",
    "jsdom",
    "@mozilla/readability",
    "epub2",
    "mammoth",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  eslint: {
    // We rely on `tsc --noEmit` for correctness; no eslint dependency is pulled in.
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // transformers.js (used in-browser for offline embeddings) must NOT pull its Node-only
    // backends into the client bundle — alias them away so it uses the WASM (onnxruntime-web)
    // runtime instead.
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "onnxruntime-node": false,
        sharp: false,
      };
    }
    return config;
  },
};

export default nextConfig;
