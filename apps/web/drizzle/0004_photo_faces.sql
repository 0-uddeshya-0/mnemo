-- Photo faces: one row per person MNEMO sees in a photo, captured as an appearance
-- "signature" + its embedding, so recurring people can be clustered across photos and,
-- once you name one, future appearances can be recognised. Identity is never asserted from
-- appearance alone — names always come from the owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'photo_faces') THEN
    CREATE TABLE photo_faces (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      photo_node_id  uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      person_node_id uuid REFERENCES nodes(id) ON DELETE SET NULL,
      signature      text NOT NULL,
      embedding      vector(384),
      created_at     timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX photo_faces_embedding_idx ON photo_faces USING hnsw (embedding vector_cosine_ops);
    CREATE INDEX photo_faces_person_idx    ON photo_faces (person_node_id);
    CREATE INDEX photo_faces_photo_idx     ON photo_faces (photo_node_id);
  END IF;
END $$;
