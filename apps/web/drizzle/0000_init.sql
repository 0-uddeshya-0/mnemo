-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Mnemosyne — initial schema. Authoritative DB definition (see lib/db/schema)║
-- ║ Idempotent: safe to run repeatedly (IF NOT EXISTS / CREATE OR REPLACE).    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── updated_at trigger helper ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── clusters ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clusters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  summary     text,
  keywords    text[],
  size        integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- ── nodes — every knowledge atom ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL,
  title          text NOT NULL,
  body           text,
  summary        text,
  properties     jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding      vector(384),
  embed_provider text NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  confidence     real NOT NULL DEFAULT 1.0,
  salience       real NOT NULL DEFAULT 0.5,
  sensitivity    text NOT NULL DEFAULT 'normal',
  status         text NOT NULL DEFAULT 'active',
  source_id      uuid REFERENCES nodes(id) ON DELETE SET NULL,
  cluster_id     uuid REFERENCES clusters(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  tsv            tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', coalesce(title, '')),   'A') ||
                   setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
                   setweight(to_tsvector('english', coalesce(body, '')),    'C')
                 ) STORED
);

DROP TRIGGER IF EXISTS nodes_set_updated_at ON nodes;
CREATE TRIGGER nodes_set_updated_at BEFORE UPDATE ON nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── edges — typed, directed relationships ───────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src        uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst        uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type       text NOT NULL,
  weight     real NOT NULL DEFAULT 0.5,
  confidence real NOT NULL DEFAULT 1.0,
  rationale  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edges_src_dst_type_uq UNIQUE (src, dst, type)
);

-- ── chunks — RAG-searchable detail ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  ordinal        integer NOT NULL,
  text           text NOT NULL,
  embedding      vector(384),
  embed_provider text NOT NULL DEFAULT 'all-MiniLM-L6-v2'
);

-- ── node_versions — belief/trait/goal evolution ─────────────────────────────
CREATE TABLE IF NOT EXISTS node_versions (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id  uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  reason   text,
  at       timestamptz NOT NULL DEFAULT now()
);

-- ── insights — synthesis feed ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,
  title      text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  node_ids   uuid[] NOT NULL DEFAULT '{}'::uuid[],
  dismissed  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── connectors — import bookkeeping ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connectors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  status      text NOT NULL DEFAULT 'idle',
  cursor      jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz
);

-- ── api_keys ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  key_hash     text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}'::text[],
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── ingest_jobs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,
  status     text NOT NULL DEFAULT 'queued',
  stage      text,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  result     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ingest_jobs_set_updated_at ON ingest_jobs;
CREATE TRIGGER ingest_jobs_set_updated_at BEFORE UPDATE ON ingest_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── interview_state (singleton) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interview_state (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase          text NOT NULL DEFAULT 'identity',
  asked          jsonb NOT NULL DEFAULT '[]'::jsonb,
  answered       jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  completeness   real NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS interview_state_set_updated_at ON interview_state;
CREATE TRIGGER interview_state_set_updated_at BEFORE UPDATE ON interview_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── activity_log (append-only audit) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text NOT NULL,
  node_id      uuid REFERENCES nodes(id) ON DELETE SET NULL,
  actor        text NOT NULL,
  actor_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Indexes (spec §3)                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
CREATE INDEX IF NOT EXISTS nodes_embedding_idx  ON nodes  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS nodes_tsv_idx        ON nodes  USING gin (tsv);
CREATE INDEX IF NOT EXISTS nodes_title_trgm     ON nodes  USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS edges_src_idx        ON edges  (src);
CREATE INDEX IF NOT EXISTS edges_dst_idx        ON edges  (dst);
CREATE INDEX IF NOT EXISTS nodes_status_idx     ON nodes  (status) WHERE status = 'active';

-- Supporting lookups
CREATE INDEX IF NOT EXISTS nodes_type_idx     ON nodes (type);
CREATE INDEX IF NOT EXISTS nodes_source_idx   ON nodes (source_id);
CREATE INDEX IF NOT EXISTS nodes_cluster_idx  ON nodes (cluster_id);
CREATE INDEX IF NOT EXISTS edges_type_idx     ON edges (type);
CREATE INDEX IF NOT EXISTS chunks_node_idx    ON chunks (node_id);
CREATE INDEX IF NOT EXISTS insights_open_idx  ON insights (created_at) WHERE dismissed = false;
CREATE INDEX IF NOT EXISTS activity_at_idx    ON activity_log (at DESC);

-- The Self node is a singleton: at most one row of type 'self'.
CREATE UNIQUE INDEX IF NOT EXISTS nodes_self_singleton ON nodes ((type)) WHERE type = 'self';
