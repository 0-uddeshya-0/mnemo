-- Vault sync state: one row per markdown file we've ingested from the owner's vault folder,
-- so only new/changed files are re-ingested.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vault_files') THEN
    CREATE TABLE vault_files (
      path        text PRIMARY KEY,
      hash        text NOT NULL,
      ingested_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;
