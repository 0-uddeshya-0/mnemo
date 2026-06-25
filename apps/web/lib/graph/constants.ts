/**
 * The canonical vocabulary of the knowledge graph: node types, edge types, and the
 * enums that gate sensitivity / status / interview phases / insight kinds. These arrays
 * are the single source of truth shared by the Drizzle schema ($type), Zod validators,
 * and the UI (color maps, filters). Keep in lockstep with the spec §3.
 */

// ── Node types (exact set, spec §3) ─────────────────────────────────────────
export const NODE_TYPES = [
  "self",
  "trait",
  "interest",
  "belief",
  "goal",
  "memory",
  "concept",
  "skill",
  "book",
  "article",
  "paper",
  "course",
  "note",
  "creative_work",
  "quote",
  "person",
  "org",
  "place",
  "event",
  "question",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Belief-like types whose edits are version-tracked in `node_versions`. */
export const VERSIONED_NODE_TYPES: NodeType[] = ["belief", "trait", "goal"];

// ── Edge types (exact set, spec §3) ─────────────────────────────────────────
export const EDGE_TYPES = [
  "relates_to",
  "part_of",
  "instance_of",
  "authored_by",
  "learned_from",
  "influenced_by",
  "contradicts",
  "supports",
  "precedes",
  "similar_to",
  "interested_in",
  "believes",
  "aspires_to",
  "mentions",
  "applies_skill",
  "supersedes",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

// ── Scalar enums ────────────────────────────────────────────────────────────
export const SENSITIVITIES = ["public", "normal", "private"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const NODE_STATUSES = ["active", "superseded", "archived"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const INTERVIEW_PHASES = [
  "identity",
  "values",
  "personality",
  "interests",
  "background",
  "experiences", // the lived events that shaped you
  "turning_points", // moments/decisions that changed your direction
  "growth", // how you've evolved — what you've outgrown, what's changed
  "daily_life", // your actual routines + rhythms
  "ways_of_thinking",
  "goals",
  "creative_self",
  "relationships",
] as const;
export type InterviewPhase = (typeof INTERVIEW_PHASES)[number];

export const INSIGHT_KINDS = [
  "contradiction",
  "gap",
  "cluster",
  "dormant",
  "evolution",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const ACTORS = ["owner", "llm", "agent"] as const;
export type Actor = (typeof ACTORS)[number];

export const CONNECTOR_PROVIDERS = [
  "readwise",
  "pocket",
  "notion",
  "x_archive",
  "browser",
] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export const INGEST_KINDS = [
  "file",
  "url",
  "note",
  "interview_answer",
  "share",
  "connector",
] as const;
export type IngestKind = (typeof INGEST_KINDS)[number];

export const JOB_STATUSES = ["queued", "running", "done", "error"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

// ── Agent runs (MNEMO's episodic memory + the daily-digest inbox) ────────────
export const AGENT_RUN_MODES = ["chat", "digest", "siri"] as const;
export type AgentRunMode = (typeof AGENT_RUN_MODES)[number];

export const AGENT_RUN_STATUSES = ["answered", "pending_review", "reviewed", "dismissed"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

// ── Node-type color map — MUTED to harmonize with the calm "Ocean Fog" theme.
// Lower-chroma, sophisticated tones; still distinguishable, never loud. Each stays
// dark enough (~45–55% L) to read as a small bold badge on white. ──
export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  self: "#3E5A5D", // brand deep teal — the spine
  belief: "#5A8A72", // muted sage
  interest: "#5B7A9E", // dusty slate-blue
  skill: "#A87E4A", // muted ochre
  concept: "#7E6BA0", // muted violet
  book: "#A06A8A", // muted mauve
  article: "#A06A8A",
  paper: "#A06A8A",
  course: "#A06A8A",
  note: "#B0705E", // muted terracotta (was loud rose)
  creative_work: "#B0705E",
  person: "#6B7A82", // slate
  org: "#6B7A82",
  place: "#6B7A82",
  question: "#4E8A8F", // muted teal-cyan
  goal: "#BE7B54", // muted warm clay
  memory: "#876FA6", // muted purple
  quote: "#6B7882", // grey slate
  event: "#4F8079", // muted teal-green
  trait: "#5A8A72", // muted sage (pairs with belief)
};

/** Human labels for edge types, used in UI tooltips/legends. */
export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  relates_to: "relates to",
  part_of: "part of",
  instance_of: "instance of",
  authored_by: "authored by",
  learned_from: "learned from",
  influenced_by: "influenced by",
  contradicts: "contradicts",
  supports: "supports",
  precedes: "precedes",
  similar_to: "similar to",
  interested_in: "interested in",
  believes: "believes",
  aspires_to: "aspires to",
  mentions: "mentions",
  applies_skill: "applies skill",
  supersedes: "supersedes",
};

/** Embedding dimensionality. Must match the DB vector(N) column + model output (MiniLM = 384). */
export const EMBED_DIM = 384;
