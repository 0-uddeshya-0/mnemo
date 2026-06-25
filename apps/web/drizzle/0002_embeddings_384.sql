-- Switch embeddings from Voyage (1024-dim) to local all-MiniLM-L6-v2 (384-dim).
-- Destructive for existing vectors (they're re-created by re-ingest / db:seed). The
-- guards make it a safe no-op once already at 384.
DO $$
BEGIN
  IF (SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'nodes'::regclass AND attname = 'embedding') <> 384 THEN
    DROP INDEX IF EXISTS nodes_embedding_idx;
    DROP INDEX IF EXISTS chunks_embedding_idx;

    ALTER TABLE nodes DROP COLUMN embedding;
    ALTER TABLE nodes ADD COLUMN embedding vector(384);
    ALTER TABLE chunks DROP COLUMN embedding;
    ALTER TABLE chunks ADD COLUMN embedding vector(384);

    CREATE INDEX nodes_embedding_idx  ON nodes  USING hnsw (embedding vector_cosine_ops);
    CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;

ALTER TABLE nodes  ALTER COLUMN embed_provider SET DEFAULT 'all-MiniLM-L6-v2';
ALTER TABLE chunks ALTER COLUMN embed_provider SET DEFAULT 'all-MiniLM-L6-v2';
