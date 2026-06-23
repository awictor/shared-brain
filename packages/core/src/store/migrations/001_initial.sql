-- SharedBrain: Initial schema
-- Memories, tags, operations, sync state, users, teams

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  title TEXT,
  type TEXT NOT NULL CHECK(type IN ('fact','procedure','decision','context','preference','reference')),
  scope TEXT NOT NULL CHECK(scope IN ('personal','team','org')),
  team_id TEXT,
  org_id TEXT,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  source_json TEXT,
  relations_json TEXT,
  hlc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  dot TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (memory_id, tag, dot),
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  author_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('create','update','delete','tag_add','tag_remove')),
  payload_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  team_id TEXT,
  org_id TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  node_id TEXT NOT NULL UNIQUE,
  org_id TEXT,
  token_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  org_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member','readonly')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, team_id, org_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_author ON memories(author_id);
CREATE INDEX IF NOT EXISTS idx_memories_hlc ON memories(hlc);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted);
CREATE INDEX IF NOT EXISTS idx_operations_synced ON operations(synced, hlc);
CREATE INDEX IF NOT EXISTS idx_operations_memory ON operations(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_tags_active ON memory_tags(memory_id, removed);
