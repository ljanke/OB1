-- Open Brain — Homelab + Tailscale schema
-- Vanilla Postgres + pgvector. No Supabase auth, no RLS.
-- Trust boundary is Tailscale + the x-brain-key header on the MCP server.
--
-- Embedding dimension is 768 to match nomic-embed-text (Ollama default).
-- If you change EMBED_MODEL, change vector(768) below to match the model's
-- output dimension and re-embed any existing rows.
--
-- Roles `openbrain_app` and `openbrain_readonly` are created by 00-roles.sh
-- before this script runs.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Schema ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS thoughts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content             TEXT NOT NULL,
  embedding           VECTOR(768),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_fingerprint TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thoughts_embedding_hnsw
  ON thoughts USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_thoughts_metadata
  ON thoughts USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at
  ON thoughts (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thoughts_fingerprint
  ON thoughts (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;

-- ---------- Triggers -------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS thoughts_updated_at ON thoughts;
CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------- Functions ------------------------------------------------------

CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.5,
  match_count     INT   DEFAULT 10,
  filter          JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id         UUID,
  content    TEXT,
  metadata   JSONB,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    (1 - (t.embedding <=> query_embedding))::FLOAT AS similarity,
    t.created_at
  FROM thoughts t
  WHERE 1 - (t.embedding <=> query_embedding) >= match_threshold
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Note: there used to be an `upsert_thought()` SQL function here, but it
-- duplicated the dedupe logic that `server/queries.ts:captureThought` already
-- runs inline (and silently diverged from it — the SQL version didn't refresh
-- the embedding on conflict). The TS path is the single source of truth.
-- If a future Python/CLI recipe needs a text-only backfill upsert primitive,
-- reintroduce it here deliberately with its semantics documented and have
-- the TS path call it via RPC.

-- ---------- Grants ---------------------------------------------------------

-- Application role: full DML on the public schema
GRANT USAGE ON SCHEMA public TO openbrain_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openbrain_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO openbrain_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO openbrain_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openbrain_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO openbrain_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO openbrain_app;

-- Read-only role: SELECT only, for direct DB inspection from
-- DBeaver/psql/TablePlus over Tailscale.
GRANT USAGE ON SCHEMA public TO openbrain_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO openbrain_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO openbrain_readonly;
