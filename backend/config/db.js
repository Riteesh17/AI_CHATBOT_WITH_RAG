const { Pool } = require("pg");

let pool;

const getPool = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Create backend/.env from backend/.env.example and add your Neon connection string."
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    pool.on("error", (error) => {
      console.error("Idle DB client error:", error);
    });
  }

  return pool;
};

const initDb = async () => {
  const activePool = getPool();

  await activePool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  // pgvector powers semantic search by storing dense embeddings directly in Postgres.
  // If Neon rejects this in your environment, run the same SQL manually in the Neon console.
  await activePool.query("CREATE EXTENSION IF NOT EXISTS vector;");
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_name VARCHAR(500) NOT NULL,
      stored_name VARCHAR(500) NOT NULL,
      file_path TEXT NOT NULL,
      file_type VARCHAR(50) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      file_size INTEGER NOT NULL,
      status VARCHAR(50) DEFAULT 'uploaded',
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await activePool.query(`
    ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(50) DEFAULT 'local',
    ADD COLUMN IF NOT EXISTS blob_name TEXT,
    ADD COLUMN IF NOT EXISTS blob_url TEXT,
    ADD COLUMN IF NOT EXISTS source_url TEXT,
    ADD COLUMN IF NOT EXISTS scraped_metadata JSONB;
  `);
  await activePool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_user_url
    ON documents(user_id, source_url)
    WHERE source_url IS NOT NULL;
  `);
  await activePool.query(`
    ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS audio_metadata JSONB,
    ADD COLUMN IF NOT EXISTS audio_summary TEXT,
    ADD COLUMN IF NOT EXISTS processing_stage VARCHAR(50),
    ADD COLUMN IF NOT EXISTS audio_duration_seconds INTEGER;
  `);

  // Check if document_chunks table exists and check its embedding dimension
  const tableCheck = await activePool.query(`
    SELECT to_regclass('document_chunks') AS exists
  `);
  const tableExists = tableCheck.rows[0]?.exists;

  if (tableExists) {
    const dimCheck = await activePool.query(`
      SELECT atttypmod 
      FROM pg_attribute 
      WHERE attrelid = 'document_chunks'::regclass 
        AND attname = 'embedding'
    `);
    const currentDim = dimCheck.rows[0]?.atttypmod;

    if (currentDim && currentDim !== 384) {
      console.log('[DB] Migrating embedding dimension from 768 to 384...');
      
      // Drop old HNSW index
      await activePool.query(`DROP INDEX IF EXISTS document_chunks_embedding_hnsw_idx`);
      await activePool.query(`DROP INDEX IF EXISTS document_chunks_embedding_idx`);
      
      // Clear all existing embeddings first (they are incompatible and block type alteration)
      await activePool.query(`
        DELETE FROM document_chunks
      `);

      // Change column dimension
      await activePool.query(`
        ALTER TABLE document_chunks 
        ALTER COLUMN embedding TYPE vector(384)
      `);
      
      // Reset all documents to 'uploaded' so they re-process
      await activePool.query(`
        UPDATE documents 
        SET status = 'uploaded', chunk_count = 0 
        WHERE status = 'ready'
      `);
      
      console.log('[DB] ⚠️  All documents reset to re-process with new embeddings');
    }
  }

  await activePool.query(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      embedding vector(384),
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await activePool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_document_chunk_idx
    ON document_chunks (document_id, chunk_index);
  `);
  await activePool.query(`
    DROP INDEX IF EXISTS document_chunks_embedding_idx;
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
    ON document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS document_chunks_user_document_idx
    ON document_chunks (user_id, document_id, chunk_index);
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS document_chunks_content_fts_idx
    ON document_chunks
    USING GIN (to_tsvector('english', content));
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(500),
      document_ids UUID[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
    ON conversations (user_id, updated_at DESC);
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      source_chunks JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
    ON messages (conversation_id, created_at ASC);
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS documents_user_created_idx
    ON documents (user_id, created_at DESC);
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS documents_user_status_idx
    ON documents (user_id, status);
  `);
};

module.exports = {
  getPool,
  initDb,
};
