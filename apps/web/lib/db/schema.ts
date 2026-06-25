/**
 * Drizzle schema — the ORM/type source of truth for Mnemosyne.
 *
 * The *database* source of truth is the hand-authored SQL in `drizzle/0000_init.sql`
 * (it owns extensions, the generated `tsv` column, and the HNSW/GIN indexes that
 * drizzle-kit can't reliably express). This file mirrors that SQL for typed queries.
 * Keep the two in lockstep.
 */
import { sql, type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { EMBED_DIM } from "@/lib/graph/constants";
import type {
  NodeType,
  EdgeType,
  Sensitivity,
  NodeStatus,
  InsightKind,
  Actor,
  ConnectorProvider,
  IngestKind,
  JobStatus,
  InterviewPhase,
  ApiScope,
  AgentRunMode,
  AgentRunStatus,
} from "@/lib/graph/constants";

// ── clusters (defined first; nodes.cluster_id references it) ────────────────
export const clusters = pgTable("clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  summary: text("summary"),
  keywords: text("keywords").array(),
  size: integer("size").default(0).notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── nodes — every knowledge atom ────────────────────────────────────────────
export const nodes = pgTable("nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").$type<NodeType>().notNull(),
  title: text("title").notNull(),
  body: text("body"),
  summary: text("summary"),
  properties: jsonb("properties").$type<Record<string, unknown>>().default({}).notNull(),
  embedding: vector("embedding", { dimensions: EMBED_DIM }),
  embedProvider: text("embed_provider").default("all-MiniLM-L6-v2").notNull(),
  confidence: real("confidence").default(1).notNull(),
  salience: real("salience").default(0.5).notNull(),
  sensitivity: text("sensitivity").$type<Sensitivity>().default("normal").notNull(),
  status: text("status").$type<NodeStatus>().default("active").notNull(),
  sourceId: uuid("source_id").references((): AnyPgColumn => nodes.id, {
    onDelete: "set null",
  }),
  clusterId: uuid("cluster_id").references(() => clusters.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // `tsv` (tsvector, GENERATED ALWAYS) lives in SQL only; queried via raw sql`tsv`.
});

// ── edges — typed, directed relationships ───────────────────────────────────
export const edges = pgTable("edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  src: uuid("src")
    .references(() => nodes.id, { onDelete: "cascade" })
    .notNull(),
  dst: uuid("dst")
    .references(() => nodes.id, { onDelete: "cascade" })
    .notNull(),
  type: text("type").$type<EdgeType>().notNull(),
  weight: real("weight").default(0.5).notNull(),
  confidence: real("confidence").default(1).notNull(),
  rationale: text("rationale"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── chunks — RAG-searchable detail of long sources ──────────────────────────
export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeId: uuid("node_id")
    .references(() => nodes.id, { onDelete: "cascade" })
    .notNull(),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: EMBED_DIM }),
  embedProvider: text("embed_provider").default("all-MiniLM-L6-v2").notNull(),
});

// ── node_versions — belief/trait/goal evolution history ─────────────────────
export const nodeVersions = pgTable("node_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  nodeId: uuid("node_id")
    .references(() => nodes.id, { onDelete: "cascade" })
    .notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

// ── insights — the "your brain noticed…" feed ───────────────────────────────
export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<InsightKind>().notNull(),
  title: text("title").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
  nodeIds: uuid("node_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  dismissed: boolean("dismissed").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── connectors — import bookkeeping (idempotent re-syncs) ────────────────────
export const connectors = pgTable("connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").$type<ConnectorProvider>().notNull(),
  status: text("status").default("idle").notNull(),
  cursor: jsonb("cursor").$type<Record<string, unknown>>().default({}).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});

// ── api_keys — agent/REST bearer keys (argon2-hashed) ───────────────────────
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes")
    .$type<ApiScope>()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── ingest_jobs — pipeline bookkeeping + live progress ──────────────────────
export const ingestJobs = pgTable("ingest_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<IngestKind>().notNull(),
  status: text("status").$type<JobStatus>().default("queued").notNull(),
  stage: text("stage"), // acquire|chunk|embed|extract|link|reconcile (live UI)
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().default({}).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── interview_state — onboarding "Know Me" engine (singleton) ────────────────
export const interviewState = pgTable("interview_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  phase: text("phase").$type<InterviewPhase>().default("identity").notNull(),
  asked: jsonb("asked").$type<unknown[]>().default([]).notNull(),
  answered: jsonb("answered").$type<unknown[]>().default([]).notNull(),
  nextQuestions: jsonb("next_questions").$type<unknown[]>().default([]).notNull(),
  completeness: real("completeness").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── activity_log — append-only audit trail ──────────────────────────────────
export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
  actor: text("actor").$type<Actor>().notNull(),
  actorKeyId: uuid("actor_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

// ── app_settings (singleton; agent-exposure controls §8.7) ──────────────────
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
});

// ── agent_runs — MNEMO's episodic memory + the daily-digest inbox ───────────
// Every agent invocation (interactive chat, Siri, or the autonomous daily digest)
// is recorded: the task, the answer, the reasoning steps, and any PROPOSED write/
// external actions awaiting the owner's approval (read-freely, ask-before-acting).
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  mode: text("mode").$type<AgentRunMode>().default("chat").notNull(),
  task: text("task").notNull(),
  answer: text("answer").default("").notNull(),
  steps: jsonb("steps").$type<unknown[]>().default([]).notNull(),
  proposals: jsonb("proposals").$type<unknown[]>().default([]).notNull(),
  status: text("status").$type<AgentRunStatus>().default("answered").notNull(),
  source: text("source").default("owner").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

// ── Inferred row types ──────────────────────────────────────────────────────
export type Node = InferSelectModel<typeof nodes>;
export type NewNode = InferInsertModel<typeof nodes>;
export type Edge = InferSelectModel<typeof edges>;
export type NewEdge = InferInsertModel<typeof edges>;
export type Chunk = InferSelectModel<typeof chunks>;
export type NewChunk = InferInsertModel<typeof chunks>;
export type NodeVersion = InferSelectModel<typeof nodeVersions>;
export type Cluster = InferSelectModel<typeof clusters>;
export type Insight = InferSelectModel<typeof insights>;
export type Connector = InferSelectModel<typeof connectors>;
export type ApiKey = InferSelectModel<typeof apiKeys>;
export type IngestJob = InferSelectModel<typeof ingestJobs>;
export type InterviewStateRow = InferSelectModel<typeof interviewState>;
export type ActivityLogRow = InferSelectModel<typeof activityLog>;
export type AgentRunRow = InferSelectModel<typeof agentRuns>;
