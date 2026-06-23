/**
 * Hybrid Logical Clock timestamp for causal ordering.
 * Format: "{wallclock_ms}:{counter:04x}:{node_id}"
 */
export type HLC = string;

/**
 * Scope determines visibility of a memory.
 */
export enum MemoryScope {
  Personal = 'personal',
  Team = 'team',
  Org = 'org',
}

/**
 * The type/category of memory for filtering.
 */
export enum MemoryType {
  Fact = 'fact',
  Procedure = 'procedure',
  Decision = 'decision',
  Context = 'context',
  Preference = 'preference',
  Reference = 'reference',
}

/**
 * Source attribution: what created this memory.
 */
export interface MemorySource {
  /** e.g. 'mcp-tool', 'cli', 'web-ui', 'import' */
  type: string;
  /** e.g. the MCP client name or tool that stored it */
  agent: string | null;
  /** e.g. conversation ID, file path, URL */
  reference: string | null;
}

/**
 * A directional link between memories.
 */
export interface MemoryRelation {
  /** Target memory ID */
  targetId: string;
  /** Relation type */
  type: 'supersedes' | 'relates_to' | 'contradicts' | 'extends';
}

/**
 * Core memory record. This is what gets stored, synced, and searched.
 */
export interface Memory {
  /** UUIDv7 — time-ordered, globally unique */
  id: string;

  /** The actual content of the memory */
  content: string;

  /** Optional title/summary for display */
  title: string | null;

  /** Classification */
  type: MemoryType;

  /** Visibility scope */
  scope: MemoryScope;

  /** Team ID (null for personal scope) */
  teamId: string | null;

  /** Org ID (null for personal scope) */
  orgId: string | null;

  /** Who created this memory */
  authorId: string;

  /** Author display name (denormalized for offline display) */
  authorName: string;

  /** Tags — managed as an OR-Set CRDT */
  tags: string[];

  /** Embedding vector (384 dimensions for all-MiniLM-L6-v2) */
  embedding: Float32Array | null;

  /** Hybrid Logical Clock — used for causal ordering and conflict resolution */
  hlc: HLC;

  /** Whether this memory has been soft-deleted */
  deleted: boolean;

  /** ISO timestamp — when first created */
  createdAt: string;

  /** ISO timestamp — last modification */
  updatedAt: string;

  /** Source attribution: what created this memory */
  source: MemorySource;

  /** Links to related memories */
  relations: MemoryRelation[];

  /** Version counter for optimistic concurrency (local only) */
  version: number;
}

/**
 * The CRDT operation log entry — what gets synced between nodes.
 */
export interface MemoryOperation {
  /** Operation ID (UUIDv7) */
  id: string;

  /** Which memory this operates on */
  memoryId: string;

  /** HLC at time of operation */
  hlc: HLC;

  /** Who performed this operation */
  authorId: string;

  /** Operation type */
  type: 'create' | 'update' | 'delete' | 'tag_add' | 'tag_remove';

  /**
   * For 'update': partial fields that changed (LWW per field).
   * For 'tag_add'/'tag_remove': { tag: string }
   * For 'create': full Memory object (minus embedding).
   * For 'delete': empty.
   */
  payload: Record<string, unknown>;

  /** Scope at time of operation (for filtering during sync) */
  scope: MemoryScope;

  /** Team/Org IDs for routing */
  teamId: string | null;
  orgId: string | null;
}
