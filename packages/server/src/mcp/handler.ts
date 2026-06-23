/**
 * MemoryHandler — core business logic for all MCP tool operations.
 *
 * Wires together the SqliteStore, EmbeddingEngine, and VectorIndex to provide
 * the full memory CRUD + semantic search lifecycle.
 */

import { randomUUID } from 'node:crypto';

// ─── Inline type definitions (avoids build-order dependency on @shared-brain/core) ───

export type HLC = string;

export type MemoryScope = 'personal' | 'team' | 'org';
export type MemoryType = 'fact' | 'procedure' | 'decision' | 'context' | 'preference' | 'reference';

export interface MemorySource {
  type: string;
  agent: string | null;
  reference: string | null;
}

export interface MemoryRelation {
  targetId: string;
  type: 'supersedes' | 'relates_to' | 'contradicts' | 'extends';
}

export interface Memory {
  id: string;
  content: string;
  title: string | null;
  type: MemoryType;
  scope: MemoryScope;
  teamId: string | null;
  orgId: string | null;
  authorId: string;
  authorName: string;
  tags: string[];
  embedding: Float32Array | null;
  hlc: HLC;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  source: MemorySource;
  relations: MemoryRelation[];
  version: number;
}

export interface MemoryOperation {
  id: string;
  memoryId: string;
  hlc: HLC;
  authorId: string;
  type: 'create' | 'update' | 'delete' | 'tag_add' | 'tag_remove';
  payload: Record<string, unknown>;
  scope: MemoryScope;
  teamId: string | null;
  orgId: string | null;
}

/**
 * Minimal interface for the SQLite store (so we don't import the concrete class).
 */
export interface Store {
  initialize(): Promise<void>;
  createMemory(memory: Memory): Promise<void>;
  getMemory(id: string): Promise<Memory | null>;
  updateMemory(id: string, fields: Partial<Memory>): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  listMemories(options: ListOptions): Promise<Memory[]>;
  countMemories(scope?: ScopeFilter): Promise<number>;
  createOperation(op: MemoryOperation): Promise<void>;
  getPendingOperations(): Promise<MemoryOperation[]>;
  getLastSyncTime(): Promise<string | null>;
  getAllTags(): Promise<Array<{ tag: string; count: number }>>;
}

/**
 * Minimal interface for the embedding engine.
 */
export interface Embeddings {
  initialize(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  getDimensions(): number;
}

/**
 * Minimal interface for the vector index.
 */
export interface VectorIndex {
  add(id: string, vector: Float32Array): void;
  remove(id: string): void;
  search(query: Float32Array, k: number, threshold?: number): Array<{ id: string; score: number }>;
  size(): number;
}

export interface ScopeFilter {
  personal?: boolean;
  teamIds?: string[];
  org?: boolean;
}

export interface SearchFilters {
  types?: string[];
  tags?: string[];
  authorId?: string;
  since?: string;
  before?: string;
}

export interface ListOptions {
  scope?: ScopeFilter;
  filters?: SearchFilters;
  sort?: 'newest' | 'oldest' | 'updated';
  limit?: number;
  offset?: number;
  userId?: string;
}

export interface StoreParams {
  content: string;
  title?: string;
  type: string;
  scope?: string;
  tags?: string[];
  relations?: Array<{ targetId: string; type: string }>;
  source?: { type?: string; agent?: string; reference?: string };
}

export interface SearchParams {
  query: string;
  scope?: ScopeFilter;
  filters?: SearchFilters;
  limit?: number;
  threshold?: number;
}

export interface UpdateParams {
  id: string;
  content?: string;
  title?: string;
  type?: string;
  scope?: string;
  tags?: { add?: string[]; remove?: string[] };
  relations?: { add?: Array<{ targetId: string; type: string }>; remove?: string[] };
}

export interface ImportParams {
  memories: Array<{
    content: string;
    title?: string;
    type?: string;
    tags?: string[];
  }>;
  scope?: string;
}

export interface ExportParams {
  scope?: ScopeFilter;
  filters?: { types?: string[]; tags?: string[] };
  format?: 'json' | 'markdown';
}

// Default user for local single-user mode
const LOCAL_USER_ID = 'local';
const LOCAL_USER_NAME = 'Local User';

export class MemoryHandler {
  constructor(
    private readonly store: Store,
    private readonly embeddings: Embeddings,
    private readonly vectorIndex: VectorIndex,
  ) {}

  /**
   * Store a new memory: compute embedding, persist, index vector, log operation.
   */
  async handleStore(params: StoreParams): Promise<{ id: string; message: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const hlc = `${Date.now()}:0000:${LOCAL_USER_ID}`;

    // Compute embedding
    const embedding = await this.embeddings.embed(params.content);

    const memory: Memory = {
      id,
      content: params.content,
      title: params.title ?? null,
      type: (params.type || 'fact') as MemoryType,
      scope: (params.scope || 'personal') as MemoryScope,
      teamId: null,
      orgId: null,
      authorId: LOCAL_USER_ID,
      authorName: LOCAL_USER_NAME,
      tags: params.tags ?? [],
      embedding,
      hlc,
      deleted: false,
      createdAt: now,
      updatedAt: now,
      source: {
        type: params.source?.type ?? 'mcp-tool',
        agent: params.source?.agent ?? null,
        reference: params.source?.reference ?? null,
      },
      relations: (params.relations ?? []).map((r) => ({
        targetId: r.targetId,
        type: r.type as MemoryRelation['type'],
      })),
      version: 1,
    };

    await this.store.createMemory(memory);
    this.vectorIndex.add(id, embedding);

    // Log the create operation
    const op: MemoryOperation = {
      id: randomUUID(),
      memoryId: id,
      hlc,
      authorId: LOCAL_USER_ID,
      type: 'create',
      payload: { content: params.content, title: params.title, type: params.type, tags: params.tags },
      scope: memory.scope,
      teamId: memory.teamId,
      orgId: memory.orgId,
    };
    await this.store.createOperation(op);

    return { id, message: `Memory stored successfully.` };
  }

  /**
   * Semantic search: embed query, search vector index, filter, return ranked results.
   */
  async handleSearch(params: SearchParams): Promise<Array<{ memory: Omit<Memory, 'embedding'>; score: number }>> {
    const limit = params.limit ?? 10;
    const threshold = params.threshold ?? 0.3;

    // Embed the query
    const queryVector = await this.embeddings.embed(params.query);

    // Search vector index (fetch extra to account for filtering)
    const candidates = this.vectorIndex.search(queryVector, limit * 3, threshold);

    const results: Array<{ memory: Omit<Memory, 'embedding'>; score: number }> = [];

    for (const candidate of candidates) {
      if (results.length >= limit) break;

      const memory = await this.store.getMemory(candidate.id);
      if (!memory || memory.deleted) continue;

      // Apply scope filter
      if (params.scope) {
        if (!this.matchesScope(memory, params.scope)) continue;
      }

      // Apply additional filters
      if (params.filters) {
        if (!this.matchesFilters(memory, params.filters)) continue;
      }

      const { embedding: _, ...memoryWithoutEmbedding } = memory;
      results.push({ memory: memoryWithoutEmbedding, score: candidate.score });
    }

    return results;
  }

  /**
   * Get a specific memory by ID with permission check.
   */
  async handleGet(params: { id: string }): Promise<Omit<Memory, 'embedding'> | null> {
    const memory = await this.store.getMemory(params.id);

    if (!memory || memory.deleted) {
      return null;
    }

    const { embedding: _, ...memoryWithoutEmbedding } = memory;
    return memoryWithoutEmbedding;
  }

  /**
   * Partial update: recompute embedding if content changed, log operation.
   */
  async handleUpdate(params: UpdateParams): Promise<{ success: boolean; message: string }> {
    const existing = await this.store.getMemory(params.id);
    if (!existing || existing.deleted) {
      return { success: false, message: 'Memory not found.' };
    }

    const now = new Date().toISOString();
    const hlc = `${Date.now()}:0000:${LOCAL_USER_ID}`;
    const updates: Partial<Memory> = { updatedAt: now, hlc, version: existing.version + 1 };

    if (params.content !== undefined) updates.content = params.content;
    if (params.title !== undefined) updates.title = params.title;
    if (params.type !== undefined) updates.type = params.type as MemoryType;
    if (params.scope !== undefined) updates.scope = params.scope as MemoryScope;

    // Handle tag changes
    if (params.tags) {
      const currentTags = new Set(existing.tags);
      if (params.tags.add) {
        for (const tag of params.tags.add) currentTags.add(tag);
      }
      if (params.tags.remove) {
        for (const tag of params.tags.remove) currentTags.delete(tag);
      }
      updates.tags = [...currentTags];
    }

    // Handle relation changes
    if (params.relations) {
      const currentRelations = [...existing.relations];
      if (params.relations.add) {
        for (const rel of params.relations.add) {
          currentRelations.push({ targetId: rel.targetId, type: rel.type as MemoryRelation['type'] });
        }
      }
      if (params.relations.remove) {
        const removeSet = new Set(params.relations.remove);
        updates.relations = currentRelations.filter((r) => !removeSet.has(r.targetId));
      } else {
        updates.relations = currentRelations;
      }
    }

    // Recompute embedding if content changed
    if (params.content !== undefined && params.content !== existing.content) {
      const newEmbedding = await this.embeddings.embed(params.content);
      updates.embedding = newEmbedding;
      this.vectorIndex.remove(params.id);
      this.vectorIndex.add(params.id, newEmbedding);
    }

    await this.store.updateMemory(params.id, updates);

    // Log operation
    const op: MemoryOperation = {
      id: randomUUID(),
      memoryId: params.id,
      hlc,
      authorId: LOCAL_USER_ID,
      type: 'update',
      payload: { ...params, id: undefined },
      scope: updates.scope ?? existing.scope,
      teamId: existing.teamId,
      orgId: existing.orgId,
    };
    await this.store.createOperation(op);

    return { success: true, message: 'Memory updated successfully.' };
  }

  /**
   * Soft-delete a memory and log the operation.
   */
  async handleDelete(params: { id: string }): Promise<{ success: boolean; message: string }> {
    const existing = await this.store.getMemory(params.id);
    if (!existing || existing.deleted) {
      return { success: false, message: 'Memory not found.' };
    }

    const now = new Date().toISOString();
    const hlc = `${Date.now()}:0000:${LOCAL_USER_ID}`;

    await this.store.updateMemory(params.id, { deleted: true, updatedAt: now, hlc });
    this.vectorIndex.remove(params.id);

    // Log operation
    const op: MemoryOperation = {
      id: randomUUID(),
      memoryId: params.id,
      hlc,
      authorId: LOCAL_USER_ID,
      type: 'delete',
      payload: {},
      scope: existing.scope,
      teamId: existing.teamId,
      orgId: existing.orgId,
    };
    await this.store.createOperation(op);

    return { success: true, message: 'Memory deleted.' };
  }

  /**
   * List memories with filters and pagination (no semantic ranking).
   */
  async handleList(params: ListOptions): Promise<{ memories: Array<Omit<Memory, 'embedding'>>; total: number }> {
    const memories = await this.store.listMemories({
      scope: params.scope,
      filters: params.filters,
      sort: params.sort ?? 'newest',
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      userId: LOCAL_USER_ID,
    });

    const total = await this.store.countMemories(params.scope);

    return {
      memories: memories.map((m) => {
        const { embedding: _, ...rest } = m;
        return rest;
      }),
      total,
    };
  }

  /**
   * Find semantically related memories given a memory ID.
   */
  async handleRelate(params: { id: string; limit?: number; threshold?: number }): Promise<Array<{ memory: Omit<Memory, 'embedding'>; score: number }>> {
    const source = await this.store.getMemory(params.id);
    if (!source || !source.embedding) {
      return [];
    }

    const limit = params.limit ?? 5;
    const threshold = params.threshold ?? 0.5;

    // Search vector index excluding the source itself
    const candidates = this.vectorIndex.search(source.embedding, limit + 1, threshold);

    const results: Array<{ memory: Omit<Memory, 'embedding'>; score: number }> = [];

    for (const candidate of candidates) {
      if (candidate.id === params.id) continue;
      if (results.length >= limit) break;

      const memory = await this.store.getMemory(candidate.id);
      if (!memory || memory.deleted) continue;

      const { embedding: _, ...memoryWithoutEmbedding } = memory;
      results.push({ memory: memoryWithoutEmbedding, score: candidate.score });
    }

    return results;
  }

  /**
   * Get sync status: pending operations count and last sync time.
   */
  async handleSyncStatus(): Promise<{ pendingOps: number; lastSyncTime: string | null; vectorCount: number }> {
    const pendingOps = await this.store.getPendingOperations();
    const lastSyncTime = await this.store.getLastSyncTime();

    return {
      pendingOps: pendingOps.length,
      lastSyncTime,
      vectorCount: this.vectorIndex.size(),
    };
  }

  /**
   * Bulk import memories.
   */
  async handleImport(params: ImportParams): Promise<{ imported: number; ids: string[] }> {
    const scope = (params.scope || 'personal') as MemoryScope;
    const ids: string[] = [];

    for (const item of params.memories) {
      const result = await this.handleStore({
        content: item.content,
        title: item.title,
        type: item.type || 'fact',
        scope,
        tags: item.tags,
      });
      ids.push(result.id);
    }

    return { imported: ids.length, ids };
  }

  /**
   * Export memories matching filters as JSON or markdown.
   */
  async handleExport(params: ExportParams): Promise<{ data: string; count: number; format: string }> {
    const format = params.format ?? 'json';

    const memories = await this.store.listMemories({
      scope: params.scope,
      filters: params.filters ? { types: params.filters.types, tags: params.filters.tags } : undefined,
      sort: 'newest',
      limit: 10000,
      offset: 0,
      userId: LOCAL_USER_ID,
    });

    const clean = memories.map((m) => {
      const { embedding: _, ...rest } = m;
      return rest;
    });

    if (format === 'markdown') {
      const lines: string[] = ['# SharedBrain Export', '', `Exported: ${new Date().toISOString()}`, `Count: ${clean.length}`, ''];
      for (const m of clean) {
        lines.push(`## ${m.title || m.id}`);
        lines.push(`- **Type:** ${m.type}`);
        lines.push(`- **Scope:** ${m.scope}`);
        lines.push(`- **Tags:** ${m.tags.join(', ') || 'none'}`);
        lines.push(`- **Created:** ${m.createdAt}`);
        lines.push('');
        lines.push(m.content);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
      return { data: lines.join('\n'), count: clean.length, format: 'markdown' };
    }

    return { data: JSON.stringify(clean, null, 2), count: clean.length, format: 'json' };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private matchesScope(memory: Memory, scope: ScopeFilter): boolean {
    if (scope.personal && memory.scope === 'personal' && memory.authorId === LOCAL_USER_ID) {
      return true;
    }
    if (scope.teamIds?.length && memory.scope === 'team' && memory.teamId && scope.teamIds.includes(memory.teamId)) {
      return true;
    }
    if (scope.org && memory.scope === 'org') {
      return true;
    }
    // If no scope filter specified, allow all
    if (!scope.personal && !scope.teamIds?.length && !scope.org) {
      return true;
    }
    return false;
  }

  private matchesFilters(memory: Memory, filters: SearchFilters): boolean {
    if (filters.types?.length && !filters.types.includes(memory.type)) {
      return false;
    }
    if (filters.tags?.length && !filters.tags.some((t) => memory.tags.includes(t))) {
      return false;
    }
    if (filters.authorId && memory.authorId !== filters.authorId) {
      return false;
    }
    if (filters.since && memory.createdAt < filters.since) {
      return false;
    }
    if (filters.before && memory.createdAt > filters.before) {
      return false;
    }
    return true;
  }
}
