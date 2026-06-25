# Mnemosyne — Build Plan & Architecture

> A single-user **personal knowledge graph API & second brain**. This doc maps the
> spec to concrete files and locks the data model before code. Read alongside the spec.

## 0. Repo shape (pnpm monorepo)

```
Mnemosyne/
├─ package.json                 # root, private, workspace scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json           # shared strict TS config
├─ docker-compose.yml           # Postgres 16 + pgvector + pg_trgm
├─ .env.example                 # every secret/var, documented
├─ README.md                    # setup + MCP snippet + extension install
├─ docs/PLAN.md                 # this file
├─ apps/
│  ├─ web/                      # Next.js 15 app (the hub + API + pipeline + MCP)
│  │  ├─ app/                   # App Router routes + /api
│  │  ├─ lib/                   # all framework-agnostic logic
│  │  ├─ components/            # shadcn ui + app components
│  │  ├─ mcp/                   # standalone MCP server (tsx), imports ../lib
│  │  ├─ drizzle/               # hand-authored init SQL + generated migrations
│  │  ├─ scripts/               # migrate, seed, worker entrypoints
│  │  └─ public/                # PWA manifest, sw, icons
│  └─ extension/                # MV3 browser extension (plain TS, no framework)
```

Why one Next.js app holds `lib/`, `app/`, and `mcp/`: the spec references those exact
paths. `lib/` is kept **framework-agnostic** (no `next/*` imports) so the MCP server,
the pg-boss worker, and seed scripts can import it via `tsx` and so can React Server
Components. The browser extension is the only separate workspace.

## 1. Data model — LOCKED (matches spec §3)

**Driver:** `postgres` (postgres.js) + `drizzle-orm/postgres-js`. pg-boss carries its own
`pg`. Vectors via Drizzle native `vector(1024)` + hand-authored HNSW indexes in the init
migration (drizzle-kit won't reliably emit `CREATE EXTENSION`, generated `tsv`, or HNSW).

### Tables
- **nodes** — knowledge atoms. `type` (20-value enum), `title`, `body`, `summary`,
  `properties jsonb`, `embedding vector(1024)`, `embed_provider`, `confidence`,
  `salience`, `sensitivity` (public|normal|private), `status` (active|superseded|archived),
  `source_id`, `cluster_id`, timestamps, generated `tsv`.
- **edges** — typed directed relationships. `(src,dst,type)` unique. `weight`,
  `confidence`, `rationale`. 16-value type enum incl. `supersedes`.
- **chunks** — RAG chunks of long sources. `node_id`, `ordinal`, `text`,
  `embedding vector(1024)`, `embed_provider`.
- **node_versions** — `snapshot jsonb`, `reason`, `at`. Belief/trait/goal history.
- **clusters** — Louvain communities: `label`, `summary`, `keywords[]`, `size`.
- **insights** — `kind` (contradiction|gap|cluster|dormant|evolution), `title`,
  `detail jsonb`, `node_ids uuid[]`, `dismissed`.
- **connectors** — import bookkeeping: `provider`, `status`, `cursor jsonb`, `last_run_at`.
- **api_keys** — `key_hash` (argon2), `scopes[]`, `last_used_at`.
- **ingest_jobs** — `kind`, `status`, `payload jsonb`, `error`.
- **interview_state** — `phase`, `asked/answered/next_questions jsonb`, `completeness`.
- **activity_log** — append-only audit: `action`, `node_id`, `actor`, `detail jsonb`, `at`.

### Indexes (hand-authored)
HNSW cosine on `nodes.embedding` and `chunks.embedding`; GIN on `nodes.tsv`; GIN trigram
on `nodes.title`; btree on `edges.src` / `edges.dst`; partial index on `nodes.status` where
active.

### Invariants (enforced in code, not just docs)
1. **Provenance is sacred** — inferred atoms keep `source_id` + a `learned_from` edge.
2. **Owner-asserted (`confidence=1.0`) outranks inferred** in all ranking & agent answers.
3. **Idempotent everything** — content-hash guard (Stage 1) + cosine≥0.92/title merge
   (Stage 4) + UPSERT on `(src,dst,type)` (Stage 5). Re-runs converge.
4. **Privacy by default for agents** — `agentVisibleFilter()` is the single choke point;
   `sensitivity='private'` and owner-hidden types never leave via MCP/REST.
5. **Nothing silently applied** — supersession, personality estimates, inferred edges are
   all owner-confirmable/editable.

## 2. Core libs (`apps/web/lib`)
- `env.ts` — zod-validated process.env (fails fast, documents every var).
- `db/index.ts`, `db/schema.ts` — drizzle client + schema (single source of truth).
- `embeddings.ts` — `embed(texts): Promise<number[][]>`; local `all-MiniLM-L6-v2` (384-dim)
  via transformers.js — free, offline; every vector row tagged with `embed_provider`.
- `llm.ts` — OpenRouter (OpenAI-compatible) over fetch; `completeJSON(schema, …)` enforces
  JSON, validates with Zod, one automatic repair retry. Default model: free Nemotron 3 Ultra.
- `crypto.ts` — argon2-derived key + AES-256-GCM for `sensitivity='private'` bodies.
- `auth/session.ts` (iron-session owner cookie), `auth/apiKeys.ts` (argon2 hash + scopes).
- `visibility.ts` — `agentVisibleFilter()` SQL fragment used by every agent read path.

## 3. Pipeline (`lib/pipeline`) — stages 1–6
`acquire → chunk → embed → extract → link → reconcile`. Each is an idempotent pg-boss job.
Single entry `ingest(input)` enqueues stage 1. Parsers: pdf-parse, epub2, mammoth,
readability+jsdom, native md/txt. Stage 5 carries the belief-evolution supersession check.

## 4. UI routes (`app/`)
`/` command search (+cmd+k) · `/graph` explorer · `/capture` (Upload/URL/Note/Import) ·
`/insights` synthesis feed · `/ask` RAG chat · `/onboarding` interview ·
`/settings/agents`. Shared **node detail drawer**. Design system per §11 (dark observatory,
Instrument Serif / Inter / JetBrains Mono, mint accent, node-type color map, z-index map).

## 5. Agents (`mcp/` + `app/api`)
MCP server (stdio + Streamable HTTP) exposing `search_knowledge`, `get_node`, `traverse`,
`whats_my_view_on`, `add_knowledge`, `recent_activity`, `my_themes`; resources
`self://profile`, `graph://stats`; prompt `represent_me`. REST mirror under `/api` with
bearer auth, zod validation, OpenAPI at `/api/openapi.json`. All reads pass
`agentVisibleFilter()`; all agent writes are `confidence ≤ 0.8` and audited.

## 6. Build order (ship each before next) — tracks spec §13
1. Foundation (scaffold, docker, schema+migration, core libs, design shell)
2. Pipeline + Capture + node drawer
3. Hybrid search + cmd+k
4. Graph explorer
5. Onboarding interview
6. Synthesis + Insights
7. Ask + MCP/REST + security enforcement
8. Connectors + PWA + extension
9. Seed/demo + README + typecheck/build verify

## 7. Quality gates
Zod at every API + LLM boundary; `strict: true`, no `any`. `pnpm typecheck` and
`pnpm --filter web build` must pass. Seed script loads a small demo brain so the UI is
never empty. Reduced-motion honored. Secrets only in `.env`.
