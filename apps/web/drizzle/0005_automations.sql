-- Automations: owner-defined recurring agent tasks ("every morning, research X"). A worker
-- tick runs the due ones and drops the result into the daily-digest inbox for review.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'automations') THEN
    CREATE TABLE automations (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      prompt      text NOT NULL,
      frequency   text NOT NULL DEFAULT 'daily',  -- daily | weekdays | weekly
      hour        int  NOT NULL DEFAULT 8,        -- 0-23 (local time)
      minute      int  NOT NULL DEFAULT 0,        -- 0-59
      weekday     int  NOT NULL DEFAULT 1,        -- 0=Sun .. 6=Sat (used when frequency='weekly')
      enabled     boolean NOT NULL DEFAULT true,
      last_run_at timestamptz,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX automations_enabled_idx ON automations (enabled);
  END IF;
END $$;
