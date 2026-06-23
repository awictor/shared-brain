-- SharedBrain PostgreSQL initialization
-- Used by the relay server for multi-user sync

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Memories table (pgvector-compatible schema)
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  title TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('fact', 'procedure', 'decision', 'context', 'preference', 'reference')),
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('personal', 'team', 'org')),
  team_id UUID,
  org_id UUID,
  author_id UUID NOT NULL,
  author_name VARCHAR(255) NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  source_json JSONB,
  relations_json JSONB DEFAULT '[]'::jsonb,
  hlc VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  embedding vector(384)
);

-- Operations table (sync log)
CREATE TABLE IF NOT EXISTS operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  memory_id UUID NOT NULL,
  hlc VARCHAR(100) NOT NULL,
  author_id UUID NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('create', 'update', 'delete', 'tag_add', 'tag_remove')),
  payload_json JSONB NOT NULL,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('personal', 'team', 'org')),
  team_id UUID,
  org_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memory tags table
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  tag VARCHAR(100) NOT NULL,
  dot VARCHAR(100) NOT NULL,
  removed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (memory_id, tag, dot)
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  node_id VARCHAR(50) NOT NULL UNIQUE,
  org_id UUID,
  token_hash VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  org_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team members table
CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'member', 'readonly')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Sync state table (for tracking relay state)
CREATE TABLE IF NOT EXISTS sync_state (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, team_id, org_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_author ON memories(author_id);
CREATE INDEX IF NOT EXISTS idx_memories_hlc ON memories(hlc);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted) WHERE deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_operations_hlc ON operations(hlc);
CREATE INDEX IF NOT EXISTS idx_operations_scope ON operations(scope, team_id, org_id);
CREATE INDEX IF NOT EXISTS idx_operations_memory ON operations(memory_id);
CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_tags_active ON memory_tags(memory_id) WHERE removed = FALSE;

-- Vector similarity index (IVFFlat for cosine distance)
-- Note: requires at least ~100 rows to be effective; falls back to sequential scan otherwise
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
