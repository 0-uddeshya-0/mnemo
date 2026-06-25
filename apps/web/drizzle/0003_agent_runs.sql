-- agent_runs — MNEMO's episodic memory + the daily-digest inbox.
-- Every agent invocation (interactive chat, Siri, or the autonomous daily digest) is
-- recorded here: the task, the answer, the reasoning steps, and any PROPOSED write/
-- external actions awaiting the owner's approval (read-freely, ask-before-acting).
-- 'pending_review' rows have proposals the owner hasn't acted on yet → the inbox.
CREATE TABLE IF NOT EXISTS agent_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode        text NOT NULL DEFAULT 'chat',        -- chat | digest | siri
  task        text NOT NULL,
  answer      text NOT NULL DEFAULT '',
  steps       jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposals   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status      text NOT NULL DEFAULT 'answered',    -- answered | pending_review | reviewed | dismissed
  source      text NOT NULL DEFAULT 'owner',       -- owner | siri | scheduler
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_runs_status_idx ON agent_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_created_idx ON agent_runs (created_at DESC);
