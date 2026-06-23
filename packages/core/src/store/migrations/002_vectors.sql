-- SharedBrain: Vector storage for semantic search
-- Stores embeddings as raw BLOB (Float32Array bytes)

CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  dimension INTEGER NOT NULL DEFAULT 384,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  computed_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);

CREATE INDEX IF NOT EXISTS idx_memory_vectors_model ON memory_vectors(model);
