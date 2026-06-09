-- 1. Switch to HNSW index (better recall than IVFFlat)
DROP INDEX IF EXISTS document_chunks_embedding_idx;
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 2. Full-text search index for fallback
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON document_chunks USING gin(content_tsv);

-- 3. Composite index for fast filtered queries
CREATE INDEX IF NOT EXISTS idx_chunks_user_doc
  ON document_chunks(user_id, document_id);

-- 4. Fast document status lookups
CREATE INDEX IF NOT EXISTS idx_docs_user_status
  ON documents(user_id, status);

-- 5. Add chunk_count column to avoid COUNT(*) joins
ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count INT DEFAULT 0;
-- Update trigger to keep it in sync:
CREATE OR REPLACE FUNCTION update_chunk_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE documents SET chunk_count = (
    SELECT COUNT(*) FROM document_chunks WHERE document_id = NEW.document_id
  ) WHERE id = NEW.document_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_chunk_count ON document_chunks;
CREATE TRIGGER trg_chunk_count
  AFTER INSERT OR DELETE ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION update_chunk_count();
