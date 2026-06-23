# SharedBrain — Architecture Document

## Overview

SharedBrain is a local-first, multi-user knowledge management system that runs as an MCP server. It enables AI agents and humans to store, retrieve, and share memories with semantic search — all without requiring third-party APIs.

**Core principles:**
- Local-first: full functionality offline, sync when connected
- Privacy by default: embeddings computed locally via ONNX
- Multi-scope: Personal → Team → Org with attribution
- Conflict-free: CRDT-based sync for eventual consistency
- Standards-based: MCP Streamable HTTP transport

---

## 1. Directory Structure

```
shared-brain/
├── packages/
│   ├── core/                    # Data models, CRDT logic, embedding engine
│   │   ├── src/
│   │   │   ├── models/
│   │   │   │   ├── memory.ts           # Memory data model
│   │   │   │   ├── scope.ts            # Scope definitions (personal/team/org)
│   │   │   │   ├── user.ts             # User/identity model
│   │   │   │   └── index.ts
│   │   │   ├── crdt/
│   │   │   │   ├── hlc.ts             # Hybrid Logical Clock
│   │   │   │   ├── lww-register.ts    # Last-Writer-Wins Register
│   │   │   │   ├── or-set.ts          # Observed-Remove Set (for tags)
│   │   │   │   ├── merkle.ts          # Merkle tree for sync diffing
│   │   │   │   └── index.ts
│   │   │   ├── embeddings/
│   │   │   │   ├── engine.ts           # ONNX embedding engine
│   │   │   │   ├── tokenizer.ts        # Tokenizer wrapper
│   │   │   │   ├── similarity.ts       # Cosine similarity + HNSW index
│   │   │   │   └── index.ts
│   │   │   ├── store/
│   │   │   │   ├── sqlite-store.ts     # SQLite storage layer
│   │   │   │   ├── migrations/
│   │   │   │   │   ├── 001_initial.ts
│   │   │   │   │   ├── 002_vectors.ts
│   │   │   │   │   └── runner.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/                  # MCP server (Streamable HTTP)
│   │   ├── src/
│   │   │   ├── mcp/
│   │   │   │   ├── tools.ts            # MCP tool definitions
│   │   │   │   ├── resources.ts        # MCP resource definitions
│   │   │   │   └── handler.ts          # Request handler / router
│   │   │   ├── auth/
│   │   │   │   ├── token.ts            # Bearer token validation
│   │   │   │   ├── oauth2.ts           # OAuth2 flow (optional)
│   │   │   │   └── middleware.ts       # Auth middleware
│   │   │   ├── transport/
│   │   │   │   ├── http.ts             # Streamable HTTP transport
│   │   │   │   └── sse.ts             # SSE for push notifications
│   │   │   ├── server.ts              # Express app setup
│   │   │   └── index.ts               # Entry point
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── sync/                    # Sync engine (client + relay server)
│   │   ├── src/
│   │   │   ├── client/
│   │   │   │   ├── sync-client.ts      # Client-side sync logic
│   │   │   │   ├── queue.ts            # Offline operation queue
│   │   │   │   └── reconciler.ts       # Merge remote changes
│   │   │   ├── relay/
│   │   │   │   ├── relay-server.ts     # WebSocket relay server
│   │   │   │   ├── rooms.ts            # Team/org room management
│   │   │   │   └── persistence.ts     # PostgreSQL persistence
│   │   │   ├── protocol/
│   │   │   │   ├── messages.ts         # Wire protocol message types
│   │   │   │   ├── diff.ts            # Merkle-tree-based diff
│   │   │   │   └── envelope.ts        # Signed message envelope
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                     # CLI for admin/testing
│       ├── src/
│       │   ├── commands/
│       │   │   ├── store.ts            # Manual memory CRUD
│       │   │   ├── search.ts           # Semantic search from CLI
│       │   │   ├── sync.ts             # Force sync / status
│       │   │   └── init.ts             # Initialize local DB
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── models/                      # ONNX model files (git-lfs or downloaded at install)
│   └── .gitkeep
│
├── docker/
│   ├── Dockerfile.relay         # Relay server container
│   └── docker-compose.yml       # Local dev (relay + postgres)
│
├── package.json                 # Workspace root
├── tsconfig.base.json
├── turbo.json                   # Turborepo config
├── .env.example
├── LICENSE                      # MIT
└── ARCHITECTURE.md              # This file
```

---

## 2. Core Data Model

### 2.1 Memory

```typescript
// packages/core/src/models/memory.ts

/**
 * Hybrid Logical Clock timestamp for causal ordering.
 * Format: "{wallclock_ms}:{counter}:{node_id}"
 */
export type HLC = string;

/**
 * Scope determines visibility of a memory.
 */
export enum MemoryScope {
  Personal = 'personal',   // Only the author can see
  Team = 'team',           // All members of the author's team
  Org = 'org',             // All members of the organization
}

/**
 * The type/category of memory for filtering.
 */
export enum MemoryType {
  Fact = 'fact',             // A discrete piece of knowledge
  Procedure = 'procedure',   // How to do something
  Decision = 'decision',     // A decision that was made and why
  Context = 'context',       // Background/situational context
  Preference = 'preference', // User/team preference
  Reference = 'reference',   // Link to external resource with annotation
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

export interface MemorySource {
  /** e.g. 'mcp-tool', 'cli', 'web-ui', 'import' */
  type: string;
  /** e.g. the MCP client name or tool that stored it */
  agent: string | null;
  /** e.g. conversation ID, file path, URL */
  reference: string | null;
}

export interface MemoryRelation {
  /** Target memory ID */
  targetId: string;
  /** Relation type */
  type: 'supersedes' | 'relates_to' | 'contradicts' | 'extends';
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
   * For 'create': full Memory object (minus embedding — recomputed locally).
   * For 'delete': empty.
   */
  payload: Record<string, unknown>;

  /** Scope at time of operation (for filtering during sync) */
  scope: MemoryScope;

  /** Team/Org IDs for routing */
  teamId: string | null;
  orgId: string | null;
}
```

### 2.2 User & Identity

```typescript
// packages/core/src/models/user.ts

export interface User {
  /** UUIDv7 */
  id: string;

  /** Display name */
  name: string;

  /** Email (used for OAuth identity) */
  email: string;

  /** Node ID for HLC (short hash of user ID + device) */
  nodeId: string;

  /** Teams this user belongs to */
  teams: TeamMembership[];

  /** Org this user belongs to */
  orgId: string | null;

  /** Auth token hash (for simple token auth) */
  tokenHash: string | null;

  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  orgId: string;
  createdAt: string;
}

export interface TeamMembership {
  teamId: string;
  role: 'admin' | 'member' | 'readonly';
  joinedAt: string;
}

export interface Org {
  id: string;
  name: string;
  createdAt: string;
}
```

### 2.3 Scope & Permissions

```typescript
// packages/core/src/models/scope.ts

export interface ScopeFilter {
  /** Include personal memories (own only) */
  personal: boolean;
  /** Include team memories (specify team IDs, or empty = all user's teams) */
  teamIds: string[];
  /** Include org-wide memories */
  org: boolean;
}

export interface PermissionCheck {
  userId: string;
  memoryScope: MemoryScope;
  memoryTeamId: string | null;
  memoryOrgId: string | null;
  operation: 'read' | 'write' | 'delete' | 'admin';
}

/**
 * Permission rules:
 * - Personal: only author can read/write/delete
 * - Team: any team member can read; author + team admins can write/delete
 * - Org: any org member can read; author + org admins can write/delete
 */
export function checkPermission(check: PermissionCheck, user: User): boolean;
```

---

## 3. Sync Protocol Design

### 3.1 Architecture

```
┌─────────────────┐         ┌─────────────────┐
│  Node A (local) │         │  Node B (local) │
│  SQLite + ops   │         │  SQLite + ops   │
└───────┬─────────┘         └───────┬─────────┘
        │                           │
        │  WebSocket (when online)  │
        └───────────┬───────────────┘
                    │
           ┌────────▼────────┐
           │   Relay Server  │
           │  PostgreSQL +   │
           │  Op Log Store   │
           └─────────────────┘
```

### 3.2 Hybrid Logical Clock (HLC)

Every node maintains a Hybrid Logical Clock that combines wall-clock time with a logical counter, producing causally-ordered timestamps without centralized coordination.

```typescript
// packages/core/src/crdt/hlc.ts

export interface HLCState {
  /** Wall clock in milliseconds */
  wallMs: number;
  /** Logical counter (incremented on ties) */
  counter: number;
  /** Unique node identifier */
  nodeId: string;
}

export class HybridLogicalClock {
  private state: HLCState;

  constructor(nodeId: string);

  /** Generate a new HLC timestamp for a local event */
  now(): HLC;

  /** Receive a remote HLC and update local state (merge) */
  receive(remote: HLC): HLC;

  /** Parse an HLC string back to components */
  static parse(hlc: HLC): HLCState;

  /** Compare two HLC values. Returns -1, 0, or 1. */
  static compare(a: HLC, b: HLC): number;
}
```

**HLC Format:** `{wallMs}:{counter:04x}:{nodeId}`

Example: `1719100800000:0001:a3f2b1c9`

### 3.3 CRDT Strategy

SharedBrain uses **per-field Last-Writer-Wins Registers (LWW-Register)** for memory fields and **Observed-Remove Sets (OR-Set)** for tags.

**Why LWW per field (not per record)?**
- Two users can concurrently edit different fields of the same memory without conflict
- The HLC determines "last" — no data loss for non-overlapping edits
- Only truly concurrent edits to the *same field* use LWW (rare in practice)

```typescript
// packages/core/src/crdt/lww-register.ts

export interface LWWField<T> {
  value: T;
  hlc: HLC;
}

/**
 * A memory record where each field is independently versioned.
 * During merge, for each field, the higher HLC wins.
 */
export interface LWWMemory {
  id: string;
  content: LWWField<string>;
  title: LWWField<string | null>;
  type: LWWField<MemoryType>;
  scope: LWWField<MemoryScope>;
  teamId: LWWField<string | null>;
  orgId: LWWField<string | null>;
  tags: ORSet<string>;  // Tags use OR-Set, not LWW
  deleted: LWWField<boolean>;
  relations: LWWField<MemoryRelation[]>;
}

export function mergeLWW<T>(local: LWWField<T>, remote: LWWField<T>): LWWField<T> {
  const cmp = HybridLogicalClock.compare(local.hlc, remote.hlc);
  if (cmp >= 0) return local;
  return remote;
}
```

```typescript
// packages/core/src/crdt/or-set.ts

/**
 * Observed-Remove Set for tags.
 * Each add generates a unique "dot" (HLC). Remove records which dots are removed.
 * Element is in the set if it has at least one un-removed dot.
 */
export interface ORSetEntry<T> {
  value: T;
  dots: Set<HLC>;  // Active dots (add events not yet removed)
}

export class ORSet<T> {
  private entries: Map<string, ORSetEntry<T>>;

  add(value: T, hlc: HLC): void;
  remove(value: T, observedDots: Set<HLC>): void;
  merge(remote: ORSet<T>): void;
  values(): T[];
  toJSON(): unknown;
  static fromJSON<T>(data: unknown): ORSet<T>;
}
```

### 3.4 Sync Flow

**Phase 1: Merkle Tree Comparison (fast diff)**

Each node maintains a Merkle tree over its operation log, bucketed by time intervals. On connect:

1. Client sends root hash of its Merkle tree
2. Server compares — if equal, nothing to sync
3. If different, recursively compare subtrees to find divergent time buckets
4. Exchange only operations from divergent buckets

```typescript
// packages/core/src/crdt/merkle.ts

export interface MerkleNode {
  hash: string;          // SHA-256 of children hashes (or leaf content)
  bucket: string;        // Time bucket key (e.g. "2024-01-15T14:00")
  children?: MerkleNode[];
}

export class MerkleSyncTree {
  /** Insert an operation into the tree */
  insert(op: MemoryOperation): void;

  /** Get the root hash */
  rootHash(): string;

  /** Get hashes at a specific depth for comparison */
  getLevel(depth: number): Map<string, string>;

  /** Find buckets that differ between local and remote */
  diff(remoteHashes: Map<string, string>): string[];
}
```

**Phase 2: Operation Exchange**

```
Client                          Relay Server
  │                                  │
  ├─── SYNC_START {rootHash} ──────► │
  │                                  │
  │ ◄── SYNC_NEED {buckets[]} ────── │  (or SYNC_OK if in sync)
  │                                  │
  ├─── SYNC_OPS {ops[]} ──────────► │  (ops from requested buckets)
  │                                  │
  │ ◄── SYNC_OPS {ops[]} ──────────  │  (ops client is missing)
  │                                  │
  ├─── SYNC_ACK {newRootHash} ─────► │
  │                                  │
  │ ◄── SYNC_COMPLETE ──────────────  │
```

**Phase 3: Live Streaming (after initial sync)**

After initial reconciliation, the WebSocket stays open. New local operations are immediately pushed; incoming remote operations are applied in real-time.

### 3.5 Wire Protocol Messages

```typescript
// packages/sync/src/protocol/messages.ts

export type SyncMessage =
  | { type: 'SYNC_START'; rootHash: string; scopes: ScopeFilter }
  | { type: 'SYNC_NEED'; buckets: string[] }
  | { type: 'SYNC_OK' }
  | { type: 'SYNC_OPS'; ops: MemoryOperation[] }
  | { type: 'SYNC_ACK'; rootHash: string }
  | { type: 'SYNC_COMPLETE' }
  | { type: 'LIVE_OP'; op: MemoryOperation }
  | { type: 'LIVE_ACK'; opId: string }
  | { type: 'AUTH'; token: string }
  | { type: 'AUTH_OK'; userId: string; nodeId: string }
  | { type: 'AUTH_FAIL'; reason: string }
  | { type: 'ERROR'; code: string; message: string };
```

### 3.6 Offline Queue

When offline, operations queue locally:

```typescript
// packages/sync/src/client/queue.ts

export interface OfflineQueue {
  /** Append an operation to the queue */
  enqueue(op: MemoryOperation): Promise<void>;

  /** Get all pending operations (ordered by HLC) */
  pending(): Promise<MemoryOperation[]>;

  /** Mark operations as synced */
  acknowledge(opIds: string[]): Promise<void>;

  /** Number of pending operations */
  size(): Promise<number>;
}
```

---

## 4. MCP Tool Definitions

The MCP server exposes these tools to AI agents:

### 4.1 Memory CRUD

```typescript
// packages/server/src/mcp/tools.ts

export const tools = [
  {
    name: 'memory_store',
    description: 'Store a new memory or update an existing one. Use this to save facts, decisions, procedures, preferences, or context that should be remembered.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content of the memory. Be specific and self-contained.',
        },
        title: {
          type: 'string',
          description: 'Optional short title/summary (< 100 chars).',
        },
        type: {
          type: 'string',
          enum: ['fact', 'procedure', 'decision', 'context', 'preference', 'reference'],
          description: 'Category of memory.',
        },
        scope: {
          type: 'string',
          enum: ['personal', 'team', 'org'],
          description: 'Visibility scope. Default: personal.',
          default: 'personal',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorical filtering.',
        },
        relations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              targetId: { type: 'string' },
              type: { type: 'string', enum: ['supersedes', 'relates_to', 'contradicts', 'extends'] },
            },
            required: ['targetId', 'type'],
          },
          description: 'Links to related memories.',
        },
        source: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            agent: { type: 'string' },
            reference: { type: 'string' },
          },
          description: 'Attribution for this memory.',
        },
      },
      required: ['content', 'type'],
    },
  },

  {
    name: 'memory_search',
    description: 'Semantic search across memories. Returns the most relevant memories by meaning, not just keyword match. Use this to recall information, check if something is already known, or find related knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query.',
        },
        scope: {
          type: 'object',
          properties: {
            personal: { type: 'boolean', default: true },
            teamIds: { type: 'array', items: { type: 'string' } },
            org: { type: 'boolean', default: false },
          },
          description: 'Which scopes to search. Default: personal only.',
        },
        filters: {
          type: 'object',
          properties: {
            types: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            authorId: { type: 'string' },
            since: { type: 'string', description: 'ISO date — only memories after this date.' },
            before: { type: 'string', description: 'ISO date — only memories before this date.' },
          },
        },
        limit: {
          type: 'number',
          description: 'Max results to return. Default: 10.',
          default: 10,
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity score (0-1). Default: 0.3.',
          default: 0.3,
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'memory_get',
    description: 'Retrieve a specific memory by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory UUID.' },
      },
      required: ['id'],
    },
  },

  {
    name: 'memory_update',
    description: 'Update an existing memory. Only provided fields will be changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory UUID to update.' },
        content: { type: 'string' },
        title: { type: 'string' },
        type: { type: 'string', enum: ['fact', 'procedure', 'decision', 'context', 'preference', 'reference'] },
        scope: { type: 'string', enum: ['personal', 'team', 'org'] },
        tags: {
          type: 'object',
          properties: {
            add: { type: 'array', items: { type: 'string' } },
            remove: { type: 'array', items: { type: 'string' } },
          },
        },
        relations: {
          type: 'object',
          properties: {
            add: { type: 'array', items: { type: 'object', properties: { targetId: { type: 'string' }, type: { type: 'string' } }, required: ['targetId', 'type'] } },
            remove: { type: 'array', items: { type: 'string', description: 'Target ID to unlink.' } },
          },
        },
      },
      required: ['id'],
    },
  },

  {
    name: 'memory_delete',
    description: 'Soft-delete a memory. It will no longer appear in searches but can be recovered.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory UUID to delete.' },
      },
      required: ['id'],
    },
  },

  {
    name: 'memory_list',
    description: 'List memories with filtering and pagination. Unlike search, this does NOT use semantic similarity — it returns memories by recency or filter criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'object',
          properties: {
            personal: { type: 'boolean', default: true },
            teamIds: { type: 'array', items: { type: 'string' } },
            org: { type: 'boolean', default: false },
          },
        },
        filters: {
          type: 'object',
          properties: {
            types: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            authorId: { type: 'string' },
            since: { type: 'string' },
            before: { type: 'string' },
          },
        },
        sort: {
          type: 'string',
          enum: ['newest', 'oldest', 'updated'],
          default: 'newest',
        },
        limit: { type: 'number', default: 20 },
        offset: { type: 'number', default: 0 },
      },
    },
  },

  {
    name: 'memory_relate',
    description: 'Find memories semantically related to a given memory ID. Useful for discovering connections.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory UUID to find relations for.' },
        limit: { type: 'number', default: 5 },
        threshold: { type: 'number', default: 0.5 },
      },
      required: ['id'],
    },
  },

  {
    name: 'sync_status',
    description: 'Get the current sync status — pending operations, connection state, last sync time.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'memory_import',
    description: 'Bulk import memories from a JSON array or markdown file.',
    inputSchema: {
      type: 'object',
      properties: {
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              title: { type: 'string' },
              type: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['content'],
          },
        },
        scope: { type: 'string', enum: ['personal', 'team', 'org'], default: 'personal' },
      },
      required: ['memories'],
    },
  },

  {
    name: 'memory_export',
    description: 'Export memories matching a filter as JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'object',
          properties: {
            personal: { type: 'boolean' },
            teamIds: { type: 'array', items: { type: 'string' } },
            org: { type: 'boolean' },
          },
        },
        filters: {
          type: 'object',
          properties: {
            types: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
        format: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
      },
    },
  },
];
```

### 4.2 MCP Resources

```typescript
// packages/server/src/mcp/resources.ts

export const resources = [
  {
    uri: 'sharedbrain://stats',
    name: 'Memory Statistics',
    description: 'Total memory count by scope, type, and sync status.',
    mimeType: 'application/json',
  },
  {
    uri: 'sharedbrain://recent',
    name: 'Recent Memories',
    description: 'Last 20 memories across all accessible scopes.',
    mimeType: 'application/json',
  },
  {
    uri: 'sharedbrain://tags',
    name: 'All Tags',
    description: 'List of all tags in use with counts.',
    mimeType: 'application/json',
  },
];
```

---

## 5. SQLite Schema (Local)

```sql
-- packages/core/src/store/migrations/001_initial.ts

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
  source_json TEXT,           -- JSON serialized MemorySource
  relations_json TEXT,        -- JSON serialized MemoryRelation[]
  hlc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  dot TEXT NOT NULL,          -- HLC dot for OR-Set
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

CREATE INDEX idx_memories_scope ON memories(scope, team_id, org_id);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_author ON memories(author_id);
CREATE INDEX idx_memories_hlc ON memories(hlc);
CREATE INDEX idx_memories_updated ON memories(updated_at);
CREATE INDEX idx_operations_synced ON operations(synced, hlc);
CREATE INDEX idx_operations_memory ON operations(memory_id);
CREATE INDEX idx_memory_tags_active ON memory_tags(memory_id, removed) WHERE removed = 0;
```

```sql
-- packages/core/src/store/migrations/002_vectors.ts

-- Virtual table for vector search (using sqlite-vss or manual HNSW)
-- Note: sqlite-vss is optional; fallback is brute-force cosine similarity
-- For production with many memories, HNSW index is built in-memory on startup.

CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,        -- Float32Array as raw bytes (384 * 4 = 1536 bytes)
  dimension INTEGER NOT NULL DEFAULT 384,
  model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  computed_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);
```

### PostgreSQL Schema (Relay/Cloud)

```sql
-- Compatible schema for the relay server (pgvector-ready)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE memories (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  title TEXT,
  type VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  team_id UUID,
  org_id UUID,
  author_id UUID NOT NULL,
  author_name VARCHAR(255) NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  source_json JSONB,
  relations_json JSONB,
  hlc VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  embedding vector(384)          -- pgvector native type
);

CREATE TABLE operations (
  id UUID PRIMARY KEY,
  memory_id UUID NOT NULL,
  hlc VARCHAR(100) NOT NULL,
  author_id UUID NOT NULL,
  type VARCHAR(20) NOT NULL,
  payload_json JSONB NOT NULL,
  scope VARCHAR(20) NOT NULL,
  team_id UUID,
  org_id UUID,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_operations_hlc ON operations(hlc);
CREATE INDEX idx_operations_scope ON operations(scope, team_id, org_id);
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## 6. Package Dependencies

### Root `package.json`

```json
{
  "name": "shared-brain",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "devDependencies": {
    "turbo": "^2.3.3",
    "typescript": "^5.7.3",
    "vitest": "^3.1.3",
    "@types/node": "^22.12.0",
    "tsx": "^4.19.3",
    "prettier": "^3.4.2",
    "eslint": "^9.18.0"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "clean": "turbo run clean"
  },
  "packageManager": "pnpm@9.15.4",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### `packages/core/package.json`

```json
{
  "name": "@shared-brain/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.7.0",
    "@xenova/transformers": "^2.17.2",
    "onnxruntime-node": "^1.20.1",
    "uuid": "^11.0.5",
    "murmurhash": "^2.0.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/uuid": "^10.0.0",
    "vitest": "^3.1.3",
    "typescript": "^5.7.3"
  }
}
```

### `packages/server/package.json`

```json
{
  "name": "@shared-brain/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest"
  },
  "dependencies": {
    "@shared-brain/core": "workspace:*",
    "@shared-brain/sync": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "express": "^5.0.1",
    "cors": "^2.8.5",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/cors": "^2.8.17",
    "@types/jsonwebtoken": "^9.0.7",
    "vitest": "^3.1.3",
    "typescript": "^5.7.3"
  }
}
```

### `packages/sync/package.json`

```json
{
  "name": "@shared-brain/sync",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start:relay": "node dist/relay/relay-server.js",
    "test": "vitest"
  },
  "dependencies": {
    "@shared-brain/core": "workspace:*",
    "ws": "^8.18.0",
    "pg": "^8.13.1",
    "reconnecting-websocket": "^4.4.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.14",
    "@types/pg": "^8.11.11",
    "vitest": "^3.1.3",
    "typescript": "^5.7.3"
  }
}
```

### `packages/cli/package.json`

```json
{
  "name": "@shared-brain/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "shared-brain": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest"
  },
  "dependencies": {
    "@shared-brain/core": "workspace:*",
    "@shared-brain/sync": "workspace:*",
    "commander": "^13.1.0",
    "chalk": "^5.4.1",
    "ora": "^8.1.1"
  },
  "devDependencies": {
    "vitest": "^3.1.3",
    "typescript": "^5.7.3"
  }
}
```

---

## 7. Embedding Engine

Uses `@xenova/transformers` (Transformers.js) to run the `all-MiniLM-L6-v2` model locally via ONNX Runtime. This produces 384-dimensional embeddings without any external API calls.

```typescript
// packages/core/src/embeddings/engine.ts

import { pipeline, env } from '@xenova/transformers';

// Disable remote model loading after first download
env.allowRemoteModels = true;  // First run downloads; set false for air-gapped
env.cacheDir = './models';      // Cache ONNX models locally

export class EmbeddingEngine {
  private extractor: Awaited<ReturnType<typeof pipeline>> | null = null;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2';
  private readonly dimensions = 384;

  async initialize(): Promise<void> {
    this.extractor = await pipeline('feature-extraction', this.modelName, {
      quantized: true,  // Use quantized model for speed (int8)
    });
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) throw new Error('Engine not initialized');
    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return new Float32Array(output.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.extractor) throw new Error('Engine not initialized');
    const results: Float32Array[] = [];
    // Process in batches of 32 for memory efficiency
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32);
      const output = await this.extractor(batch, {
        pooling: 'mean',
        normalize: true,
      });
      for (let j = 0; j < batch.length; j++) {
        results.push(new Float32Array(output[j].data));
      }
    }
    return results;
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
```

```typescript
// packages/core/src/embeddings/similarity.ts

/**
 * Cosine similarity between two normalized vectors.
 * Since vectors are pre-normalized, dot product = cosine similarity.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Simple in-memory HNSW-like index for fast approximate nearest neighbor.
 * For <100k memories, brute-force is fine. This is the upgrade path.
 */
export class VectorIndex {
  private vectors: Map<string, Float32Array> = new Map();

  add(id: string, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }

  remove(id: string): void {
    this.vectors.delete(id);
  }

  /**
   * Find k nearest neighbors by cosine similarity.
   * Returns sorted by descending similarity.
   */
  search(query: Float32Array, k: number, threshold: number = 0.0): Array<{ id: string; score: number }> {
    const results: Array<{ id: string; score: number }> = [];

    for (const [id, vector] of this.vectors) {
      const score = cosineSimilarity(query, vector);
      if (score >= threshold) {
        results.push({ id, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  size(): number {
    return this.vectors.size;
  }
}
```

---

## 8. MCP Server Implementation (Streamable HTTP)

```typescript
// packages/server/src/transport/http.ts

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function createHttpTransport(server: McpServer, app: express.Application): void {
  // Streamable HTTP endpoint — single URL for all MCP communication
  app.all('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Connect to MCP server instance
    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });
}
```

```typescript
// packages/server/src/server.ts

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHttpTransport } from './transport/http.js';
import { registerTools } from './mcp/tools.js';
import { registerResources } from './mcp/resources.js';
import { authMiddleware } from './auth/middleware.js';
import { SqliteStore } from '@shared-brain/core';
import { EmbeddingEngine } from '@shared-brain/core';
import { SyncClient } from '@shared-brain/sync';

export interface ServerConfig {
  port: number;
  dbPath: string;
  authToken?: string;        // Simple bearer token (for single-user)
  syncUrl?: string;          // WebSocket URL for relay server
  modelsPath?: string;       // Path to ONNX model cache
}

export async function createServer(config: ServerConfig) {
  // Initialize core services
  const store = new SqliteStore(config.dbPath);
  await store.initialize();

  const embeddings = new EmbeddingEngine();
  await embeddings.initialize();

  // Optional sync client
  let syncClient: SyncClient | null = null;
  if (config.syncUrl) {
    syncClient = new SyncClient({ url: config.syncUrl, store });
    await syncClient.connect();
  }

  // Create MCP server
  const mcpServer = new McpServer({
    name: 'shared-brain',
    version: '0.1.0',
  });

  // Register tools and resources
  registerTools(mcpServer, { store, embeddings, syncClient });
  registerResources(mcpServer, { store });

  // Create Express app
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Auth (optional — skip for local-only usage)
  if (config.authToken) {
    app.use('/mcp', authMiddleware(config.authToken));
  }

  // Mount MCP transport
  createHttpTransport(mcpServer, app);

  return { app, mcpServer, store, embeddings, syncClient };
}
```

---

## 9. Key Files to Create (Implementation Order)

### Phase 1: Core (get memory CRUD + search working locally)

| # | File | Purpose |
|---|------|---------|
| 1 | `packages/core/src/models/memory.ts` | Memory interfaces (from section 2.1) |
| 2 | `packages/core/src/models/user.ts` | User/Team/Org interfaces |
| 3 | `packages/core/src/models/scope.ts` | Permission checking |
| 4 | `packages/core/src/crdt/hlc.ts` | Hybrid Logical Clock |
| 5 | `packages/core/src/store/migrations/001_initial.ts` | SQLite schema |
| 6 | `packages/core/src/store/migrations/002_vectors.ts` | Vector table |
| 7 | `packages/core/src/store/migrations/runner.ts` | Migration runner |
| 8 | `packages/core/src/store/sqlite-store.ts` | Full CRUD on SQLite |
| 9 | `packages/core/src/embeddings/engine.ts` | ONNX embedding |
| 10 | `packages/core/src/embeddings/similarity.ts` | Vector search |
| 11 | `packages/core/src/index.ts` | Barrel export |

### Phase 2: MCP Server (expose as MCP tools)

| # | File | Purpose |
|---|------|---------|
| 12 | `packages/server/src/mcp/tools.ts` | All MCP tool definitions + handlers |
| 13 | `packages/server/src/mcp/resources.ts` | MCP resource definitions |
| 14 | `packages/server/src/mcp/handler.ts` | Tool dispatch logic |
| 15 | `packages/server/src/transport/http.ts` | Streamable HTTP transport |
| 16 | `packages/server/src/auth/token.ts` | Token validation |
| 17 | `packages/server/src/auth/middleware.ts` | Express auth middleware |
| 18 | `packages/server/src/server.ts` | Server assembly |
| 19 | `packages/server/src/index.ts` | Entry point (starts server) |

### Phase 3: Sync (enable multi-user)

| # | File | Purpose |
|---|------|---------|
| 20 | `packages/core/src/crdt/lww-register.ts` | LWW merge logic |
| 21 | `packages/core/src/crdt/or-set.ts` | OR-Set for tags |
| 22 | `packages/core/src/crdt/merkle.ts` | Merkle sync tree |
| 23 | `packages/sync/src/protocol/messages.ts` | Wire protocol types |
| 24 | `packages/sync/src/protocol/envelope.ts` | Signed envelope |
| 25 | `packages/sync/src/protocol/diff.ts` | Merkle diff algorithm |
| 26 | `packages/sync/src/client/sync-client.ts` | Client sync logic |
| 27 | `packages/sync/src/client/queue.ts` | Offline operation queue |
| 28 | `packages/sync/src/client/reconciler.ts` | Merge remote changes |
| 29 | `packages/sync/src/relay/relay-server.ts` | WebSocket relay |
| 30 | `packages/sync/src/relay/rooms.ts` | Scope-based rooms |
| 31 | `packages/sync/src/relay/persistence.ts` | PostgreSQL op log |

### Phase 4: CLI + Polish

| # | File | Purpose |
|---|------|---------|
| 32 | `packages/cli/src/commands/init.ts` | Initialize local DB |
| 33 | `packages/cli/src/commands/store.ts` | Store memories from CLI |
| 34 | `packages/cli/src/commands/search.ts` | Search from CLI |
| 35 | `packages/cli/src/commands/sync.ts` | Sync status/force |
| 36 | `packages/cli/src/index.ts` | CLI entry point |

### Config & Build

| # | File | Purpose |
|---|------|---------|
| 37 | `package.json` | Root workspace |
| 38 | `tsconfig.base.json` | Shared TS config |
| 39 | `turbo.json` | Turborepo pipeline |
| 40 | `packages/core/tsconfig.json` | Core TS config |
| 41 | `packages/server/tsconfig.json` | Server TS config |
| 42 | `packages/sync/tsconfig.json` | Sync TS config |
| 43 | `packages/cli/tsconfig.json` | CLI TS config |
| 44 | `.env.example` | Environment variables |
| 45 | `docker/docker-compose.yml` | Dev environment |
| 46 | `docker/Dockerfile.relay` | Relay server container |

---

## 10. Configuration

```bash
# .env.example

# Server
PORT=3100
HOST=127.0.0.1

# Database
DB_PATH=./data/shared-brain.db

# Auth (simple token mode — for single-user or dev)
AUTH_TOKEN=your-secret-token-here

# Sync relay (optional — omit for local-only)
SYNC_RELAY_URL=ws://localhost:3200
SYNC_AUTH_TOKEN=your-sync-token

# Embeddings
MODELS_PATH=./models
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2

# PostgreSQL (relay server only)
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=sharedbrain
PG_USER=sharedbrain
PG_PASSWORD=your-pg-password
```

---

## 11. MCP Client Configuration

To connect Claude Code (or any MCP client) to SharedBrain:

```json
{
  "mcpServers": {
    "shared-brain": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3100/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-token-here"
      }
    }
  }
}
```

---

## 12. Design Decisions & Tradeoffs

| Decision | Rationale | Alternative Considered |
|----------|-----------|----------------------|
| SQLite local + Postgres cloud | SQLite is perfect for local-first (single writer, fast, zero config). Postgres for cloud gives pgvector + multi-reader. Schema kept compatible. | PouchDB/CouchDB — too heavy, separate query language |
| Per-field LWW (not whole-record) | Minimizes data loss on concurrent edits. Two users editing title vs content = both changes preserved. | Operational Transform — too complex for this use case |
| OR-Set for tags | Tags are naturally set-valued. OR-Set ensures add+remove by different users converges correctly. | LWW array — loses concurrent adds |
| HLC (not vector clocks) | HLC gives total order with single scalar, low storage overhead. Vector clocks grow linearly with nodes. | Lamport timestamps — no wall-clock alignment |
| Merkle tree for sync diff | O(log n) to find divergent operations. Avoids sending full op log on every sync. | Version vectors — fine for few nodes, poor for many |
| all-MiniLM-L6-v2 | 384 dims, fast inference, good quality for short text. Runs in ~10ms per embedding on CPU. | bge-small, e5-small — slightly better but larger |
| Quantized ONNX (int8) | 4x smaller model, ~2x faster inference, negligible quality loss for retrieval. | FP32 — better accuracy but 90MB model vs 22MB |
| Streamable HTTP (not stdio) | Multi-user access, remote clients, works with any HTTP client. Stdio limits to single process. | Stdio — simpler but single-user only |
| Soft delete | Sync requires tombstones. Hard delete would cause resurrection on sync. | Hard delete with separate tombstone table — more complex |

---

## 13. Scaling Considerations

- **< 10k memories**: Brute-force cosine similarity is fine (~5ms search)
- **10k-100k**: In-memory HNSW index (hnswlib-node or custom) — ~1ms search
- **100k+**: Consider sqlite-vss extension or migrate hot path to pgvector
- **Multi-device single user**: Relay server is optional — can sync via file (Dropbox/iCloud) by sharing the SQLite + op log
- **Large teams (50+)**: Relay server should shard by team_id for WebSocket rooms

---

## 14. Security Model

1. **Local mode** (no sync): No auth needed — server binds to 127.0.0.1 only
2. **Single-user with sync**: Bearer token in header, validated against hash in config
3. **Team/org mode**: OAuth2 authorization code flow with PKCE; relay server validates JWTs
4. **Data at rest**: SQLite file permissions (OS-level). Optional: SQLCipher for encryption.
5. **Data in transit**: TLS required for sync (WSS://). Local MCP can be plain HTTP on loopback.
6. **Scope enforcement**: Every query is filtered by user's scope permissions. The relay server only forwards operations the user is authorized to receive.
