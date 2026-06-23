import Database from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { MigrationRunner } from './migrations/runner.js';
import type { Memory, MemoryOperation, MemoryScope, MemorySource, MemoryRelation } from '../models/memory.js';
import type { ScopeFilter } from '../models/scope.js';

export interface MemoryFilters {
  types?: string[];
  tags?: string[];
  authorId?: string;
  since?: string;
  before?: string;
}

export type SortOrder = 'newest' | 'oldest' | 'updated';

/**
 * SQLite-backed store for memories and operations.
 * Handles all local persistence including vector storage.
 */
export class SqliteStore {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  /**
   * Initialize the database: run all pending migrations.
   */
  initialize(): void {
    const runner = new MigrationRunner(this.db);
    runner.run();
  }

  /**
   * Create a new memory record.
   */
  createMemory(memory: Memory): Memory {
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, title, type, scope, team_id, org_id, author_id, author_name, deleted, source_json, relations_json, hlc, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.id,
      memory.content,
      memory.title,
      memory.type,
      memory.scope,
      memory.teamId,
      memory.orgId,
      memory.authorId,
      memory.authorName,
      memory.deleted ? 1 : 0,
      JSON.stringify(memory.source),
      JSON.stringify(memory.relations),
      memory.hlc,
      memory.createdAt,
      memory.updatedAt,
      memory.version
    );

    // Insert tags
    if (memory.tags.length > 0) {
      const tagStmt = this.db.prepare(
        'INSERT INTO memory_tags (memory_id, tag, dot, removed) VALUES (?, ?, ?, 0)'
      );
      for (const tag of memory.tags) {
        tagStmt.run(memory.id, tag, memory.hlc);
      }
    }

    return memory;
  }

  /**
   * Get a memory by ID. Returns null if not found or soft-deleted.
   */
  getMemory(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return null;

    return this.rowToMemory(row);
  }

  /**
   * Update a memory with partial fields.
   * Increments version and updates updatedAt.
   */
  updateMemory(id: string, partial: Partial<Pick<Memory, 'content' | 'title' | 'type' | 'scope' | 'teamId' | 'orgId' | 'deleted' | 'hlc' | 'source' | 'relations'>>): Memory | null {
    const existing = this.getMemory(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: any[] = [];

    if (partial.content !== undefined) {
      updates.push('content = ?');
      values.push(partial.content);
    }
    if (partial.title !== undefined) {
      updates.push('title = ?');
      values.push(partial.title);
    }
    if (partial.type !== undefined) {
      updates.push('type = ?');
      values.push(partial.type);
    }
    if (partial.scope !== undefined) {
      updates.push('scope = ?');
      values.push(partial.scope);
    }
    if (partial.teamId !== undefined) {
      updates.push('team_id = ?');
      values.push(partial.teamId);
    }
    if (partial.orgId !== undefined) {
      updates.push('org_id = ?');
      values.push(partial.orgId);
    }
    if (partial.deleted !== undefined) {
      updates.push('deleted = ?');
      values.push(partial.deleted ? 1 : 0);
    }
    if (partial.hlc !== undefined) {
      updates.push('hlc = ?');
      values.push(partial.hlc);
    }
    if (partial.source !== undefined) {
      updates.push('source_json = ?');
      values.push(JSON.stringify(partial.source));
    }
    if (partial.relations !== undefined) {
      updates.push('relations_json = ?');
      values.push(JSON.stringify(partial.relations));
    }

    // Always update version and updatedAt
    updates.push('version = version + 1');
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());

    values.push(id);

    this.db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getMemory(id);
  }

  /**
   * Soft-delete a memory by setting deleted = 1.
   */
  deleteMemory(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE memories SET deleted = 1, updated_at = ?, version = version + 1 WHERE id = ? AND deleted = 0'
    ).run(new Date().toISOString(), id);

    return result.changes > 0;
  }

  /**
   * List memories with scope filtering, additional filters, sorting, and pagination.
   */
  listMemories(
    userId: string,
    scope: ScopeFilter,
    filters?: MemoryFilters,
    sort: SortOrder = 'newest',
    limit: number = 20,
    offset: number = 0
  ): Memory[] {
    const conditions: string[] = ['m.deleted = 0'];
    const params: any[] = [];

    // Scope conditions
    const scopeConditions: string[] = [];
    if (scope.personal) {
      scopeConditions.push("(m.scope = 'personal' AND m.author_id = ?)");
      params.push(userId);
    }
    if (scope.teamIds.length > 0) {
      const placeholders = scope.teamIds.map(() => '?').join(',');
      scopeConditions.push(`(m.scope = 'team' AND m.team_id IN (${placeholders}))`);
      params.push(...scope.teamIds);
    }
    if (scope.org) {
      scopeConditions.push("(m.scope = 'org')");
    }

    if (scopeConditions.length > 0) {
      conditions.push(`(${scopeConditions.join(' OR ')})`);
    } else {
      // No scopes selected — return nothing
      return [];
    }

    // Additional filters
    if (filters?.types && filters.types.length > 0) {
      const placeholders = filters.types.map(() => '?').join(',');
      conditions.push(`m.type IN (${placeholders})`);
      params.push(...filters.types);
    }
    if (filters?.authorId) {
      conditions.push('m.author_id = ?');
      params.push(filters.authorId);
    }
    if (filters?.since) {
      conditions.push('m.created_at >= ?');
      params.push(filters.since);
    }
    if (filters?.before) {
      conditions.push('m.created_at < ?');
      params.push(filters.before);
    }

    // Tag filter requires a subquery
    let tagJoin = '';
    if (filters?.tags && filters.tags.length > 0) {
      tagJoin = `
        INNER JOIN (
          SELECT memory_id FROM memory_tags
          WHERE removed = 0 AND tag IN (${filters.tags.map(() => '?').join(',')})
          GROUP BY memory_id
          HAVING COUNT(DISTINCT tag) = ?
        ) t ON t.memory_id = m.id
      `;
      params.push(...filters.tags, filters.tags.length);
    }

    // Sort
    let orderBy: string;
    switch (sort) {
      case 'oldest':
        orderBy = 'm.created_at ASC';
        break;
      case 'updated':
        orderBy = 'm.updated_at DESC';
        break;
      case 'newest':
      default:
        orderBy = 'm.created_at DESC';
        break;
    }

    const sql = `
      SELECT m.* FROM memories m
      ${tagJoin}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Search memories by vector similarity (brute-force cosine similarity).
   * Returns memories sorted by descending similarity score.
   */
  searchByVector(
    queryVector: Float32Array,
    userId: string,
    scope: ScopeFilter,
    limit: number = 10,
    threshold: number = 0.3
  ): Array<{ memory: Memory; score: number }> {
    // First get all candidate memory IDs from scope
    const memories = this.listMemories(userId, scope, undefined, 'newest', 10000, 0);
    const memoryIds = memories.map((m) => m.id);

    if (memoryIds.length === 0) return [];

    // Get vectors for these memories
    const placeholders = memoryIds.map(() => '?').join(',');
    const vectorRows = this.db
      .prepare(`SELECT memory_id, embedding FROM memory_vectors WHERE memory_id IN (${placeholders})`)
      .all(...memoryIds) as Array<{ memory_id: string; embedding: Buffer }>;

    // Compute cosine similarity
    const results: Array<{ memory: Memory; score: number }> = [];
    const memoryMap = new Map(memories.map((m) => [m.id, m]));

    for (const row of vectorRows) {
      const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const score = this.cosineSimilarity(queryVector, stored);

      if (score >= threshold) {
        const memory = memoryMap.get(row.memory_id);
        if (memory) {
          results.push({ memory, score });
        }
      }
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Store an embedding vector for a memory.
   */
  storeVector(memoryId: string, embedding: Float32Array): void {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    this.db.prepare(`
      INSERT OR REPLACE INTO memory_vectors (memory_id, embedding, dimension, model, computed_at)
      VALUES (?, ?, ?, 'all-MiniLM-L6-v2', ?)
    `).run(memoryId, buffer, embedding.length, new Date().toISOString());
  }

  /**
   * Create an operation log entry.
   */
  createOperation(op: MemoryOperation): void {
    this.db.prepare(`
      INSERT INTO operations (id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id, synced, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      op.id,
      op.memoryId,
      op.hlc,
      op.authorId,
      op.type,
      JSON.stringify(op.payload),
      op.scope,
      op.teamId,
      op.orgId,
      new Date().toISOString()
    );
  }

  /**
   * Get all unsynced operations, ordered by HLC.
   */
  getPendingOperations(): MemoryOperation[] {
    const rows = this.db
      .prepare('SELECT * FROM operations WHERE synced = 0 ORDER BY hlc ASC')
      .all() as any[];

    return rows.map((row) => this.rowToOperation(row));
  }

  /**
   * Mark operations as synced.
   */
  markOperationsSynced(opIds: string[]): void {
    if (opIds.length === 0) return;

    const placeholders = opIds.map(() => '?').join(',');
    this.db.prepare(`UPDATE operations SET synced = 1 WHERE id IN (${placeholders})`).run(...opIds);
  }

  /**
   * Add a tag to a memory (OR-Set add).
   */
  addTag(memoryId: string, tag: string, dot: string): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO memory_tags (memory_id, tag, dot, removed) VALUES (?, ?, ?, 0)'
    ).run(memoryId, tag, dot);
  }

  /**
   * Remove a tag from a memory (OR-Set remove — marks dots as removed).
   */
  removeTag(memoryId: string, tag: string): void {
    this.db.prepare(
      'UPDATE memory_tags SET removed = 1 WHERE memory_id = ? AND tag = ? AND removed = 0'
    ).run(memoryId, tag);
  }

  /**
   * Get active tags for a memory.
   */
  getTags(memoryId: string): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT tag FROM memory_tags WHERE memory_id = ? AND removed = 0')
      .all(memoryId) as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get the underlying database instance (for advanced use/testing).
   */
  getDb(): Database.Database {
    return this.db;
  }

  // --- Private helpers ---

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      title: row.title ?? null,
      type: row.type,
      scope: row.scope,
      teamId: row.team_id ?? null,
      orgId: row.org_id ?? null,
      authorId: row.author_id,
      authorName: row.author_name,
      tags: this.getTags(row.id),
      embedding: null, // Not loaded by default — use vector store
      hlc: row.hlc,
      deleted: row.deleted === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: row.source_json ? JSON.parse(row.source_json) : { type: 'unknown', agent: null, reference: null },
      relations: row.relations_json ? JSON.parse(row.relations_json) : [],
      version: row.version,
    };
  }

  private rowToOperation(row: any): MemoryOperation {
    return {
      id: row.id,
      memoryId: row.memory_id,
      hlc: row.hlc,
      authorId: row.author_id,
      type: row.type,
      payload: JSON.parse(row.payload_json),
      scope: row.scope as MemoryScope,
      teamId: row.team_id ?? null,
      orgId: row.org_id ?? null,
    };
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
  }
}
