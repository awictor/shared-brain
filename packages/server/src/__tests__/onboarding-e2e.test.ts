/**
 * End-to-end onboarding flow integration tests for SharedBrain.
 *
 * Tests the complete multi-user onboarding journey:
 * - Multi-user registration and memory storage
 * - Cross-user visibility (shared read)
 * - Ownership enforcement (write restricted)
 * - Memory operations (import, export, relate)
 * - Health checks via HTTP
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createServer } from '../server.js';
import { MemoryHandler } from '../mcp/handler.js';
import type { Store, Embeddings, VectorIndex, Memory, MemoryOperation, ListOptions, ScopeFilter } from '../mcp/handler.js';

// ─── In-memory test implementations ────────────────────────────────────────

class InMemoryStore implements Store {
  private memories: Map<string, Memory> = new Map();
  private operations: MemoryOperation[] = [];

  async initialize(): Promise<void> {}

  async createMemory(memory: Memory): Promise<void> {
    // Check memory limit (simulating max 10000 per user)
    const userMemories = [...this.memories.values()].filter(m => m.authorId === memory.authorId && !m.deleted);
    if (userMemories.length >= 10000) {
      throw new Error(`Memory limit reached: user ${memory.authorId} has ${userMemories.length}/10000 memories`);
    }
    this.memories.set(memory.id, memory);
  }

  async getMemory(id: string): Promise<Memory | null> {
    return this.memories.get(id) ?? null;
  }

  async updateMemory(id: string, fields: Partial<Memory>): Promise<void> {
    const existing = this.memories.get(id);
    if (existing) {
      this.memories.set(id, { ...existing, ...fields });
    }
  }

  async deleteMemory(id: string): Promise<void> {
    const existing = this.memories.get(id);
    if (existing) {
      this.memories.set(id, { ...existing, deleted: true });
    }
  }

  async listMemories(options: ListOptions): Promise<Memory[]> {
    let results = [...this.memories.values()].filter((m) => !m.deleted);

    if (options.scope) {
      results = results.filter((m) => {
        const s = options.scope!;
        if (s.personal && m.scope === 'personal') return true;
        if (s.teamIds?.length && m.scope === 'team' && m.teamId && s.teamIds.includes(m.teamId)) return true;
        if (s.org && m.scope === 'org') return true;
        if (!s.personal && !s.teamIds?.length && !s.org) return true;
        return false;
      });
    }

    if (options.filters) {
      const f = options.filters;
      if (f.types?.length) results = results.filter((m) => f.types!.includes(m.type));
      if (f.tags?.length) results = results.filter((m) => f.tags!.some((t) => m.tags.includes(t)));
      if (f.authorId) results = results.filter((m) => m.authorId === f.authorId);
      if (f.since) results = results.filter((m) => m.createdAt >= f.since!);
      if (f.before) results = results.filter((m) => m.createdAt <= f.before!);
    }

    const sort = options.sort ?? 'newest';
    if (sort === 'newest') results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === 'oldest') results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return results.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 20));
  }

  async countMemories(): Promise<number> {
    return [...this.memories.values()].filter((m) => !m.deleted).length;
  }

  async createOperation(op: MemoryOperation): Promise<void> {
    this.operations.push(op);
  }

  async getPendingOperations(): Promise<MemoryOperation[]> {
    return this.operations;
  }

  async getLastSyncTime(): Promise<string | null> {
    return null;
  }

  async getAllTags(): Promise<Array<{ tag: string; count: number }>> {
    const tagCounts = new Map<string, number>();
    for (const memory of this.memories.values()) {
      if (memory.deleted) continue;
      for (const tag of memory.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    return [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }
}

class InMemoryVectorIndex implements VectorIndex {
  private vectors: Map<string, Float32Array> = new Map();

  add(id: string, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }

  remove(id: string): void {
    this.vectors.delete(id);
  }

  search(query: Float32Array, k: number, threshold: number = 0.0): Array<{ id: string; score: number }> {
    const results: Array<{ id: string; score: number }> = [];
    for (const [id, vector] of this.vectors) {
      let dot = 0;
      for (let i = 0; i < query.length; i++) dot += query[i] * (vector[i] ?? 0);
      if (dot >= threshold) results.push({ id, score: dot });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  size(): number {
    return this.vectors.size;
  }
}

class SimpleEmbeddingEngine implements Embeddings {
  private readonly dimensions = 384;

  async initialize(): Promise<void> {}

  async embed(text: string): Promise<Float32Array> {
    return this.hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.hashEmbed(t));
  }

  getDimensions(): number {
    return this.dimensions;
  }

  private hashEmbed(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    const normalized = text.toLowerCase().trim();
    for (let i = 0; i < normalized.length; i++) {
      vector[i % this.dimensions] += normalized.charCodeAt(i) * (1 + i * 0.001);
    }
    let magnitude = 0;
    for (let i = 0; i < this.dimensions; i++) magnitude += vector[i] * vector[i];
    magnitude = Math.sqrt(magnitude);
    if (magnitude > 0) {
      for (let i = 0; i < this.dimensions; i++) vector[i] /= magnitude;
    }
    return vector;
  }
}

// ─── Test suite using direct handler calls ────────────────────────────────

describe('SharedBrain Onboarding E2E Flow', () => {
  let store: InMemoryStore;
  let embeddings: SimpleEmbeddingEngine;
  let vectorIndex: InMemoryVectorIndex;
  let aliceHandler: MemoryHandler;
  let bobHandler: MemoryHandler;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    store = new InMemoryStore();
    embeddings = new SimpleEmbeddingEngine();
    vectorIndex = new InMemoryVectorIndex();

    await store.initialize();
    await embeddings.initialize();

    // Create per-user handlers (simulates what happens when X-User-Id headers are sent)
    aliceHandler = new MemoryHandler(store, embeddings, vectorIndex, undefined, undefined, undefined, 'alice', 'Alice Smith');
    bobHandler = new MemoryHandler(store, embeddings, vectorIndex, undefined, undefined, undefined, 'bob', 'Bob Jones');

    // Create HTTP server for health check tests
    const result = await createServer(
      { port: 0, host: '127.0.0.1', dbPath: ':memory:' },
      {
        store,
        embeddings,
        vectorIndex,
      },
    );

    await new Promise<void>((resolve) => {
      server = result.app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // ─── Test 1: Multi-user memory storage ───────────────────────────────────

  describe('1. Multi-user memory storage', () => {
    it('User A stores a memory → authorId stamped as alice', async () => {
      const result = await aliceHandler.handleStore({
        content: 'Alice knowledge: TypeScript best practices for React hooks.',
        type: 'fact',
        tags: ['typescript', 'react'],
      });

      expect(result.id).toBeDefined();
      expect(result.id).toHaveLength(36);

      const memory = await store.getMemory(result.id);
      expect(memory).not.toBeNull();
      expect(memory!.authorId).toBe('alice');
      expect(memory!.authorName).toBe('Alice Smith');
    });

    it('User B stores a memory → authorId stamped as bob', async () => {
      const result = await bobHandler.handleStore({
        content: 'Bob knowledge: Kubernetes deployment strategies and troubleshooting.',
        type: 'procedure',
        tags: ['kubernetes', 'devops'],
      });

      expect(result.id).toBeDefined();

      const memory = await store.getMemory(result.id);
      expect(memory!.authorId).toBe('bob');
      expect(memory!.authorName).toBe('Bob Jones');
    });

    it('Both memories exist in store with correct ownership', async () => {
      const aliceList = await aliceHandler.handleList({ mine: true, limit: 50 });
      expect(aliceList.memories.length).toBe(1);
      expect(aliceList.memories[0].authorId).toBe('alice');

      const bobList = await bobHandler.handleList({ mine: true, limit: 50 });
      expect(bobList.memories.length).toBe(1);
      expect(bobList.memories[0].authorId).toBe('bob');
    });
  });

  // ─── Test 2: Cross-user visibility ───────────────────────────────────────

  describe('2. Cross-user visibility (shared read)', () => {
    it('User A searches → finds both alice and bob memories', async () => {
      const results = await aliceHandler.handleSearch({
        query: 'knowledge best practices strategies',
        limit: 10,
        threshold: 0.1,
      });

      expect(results.length).toBe(2);
      const authors = results.map((r) => r.memory.authorId);
      expect(authors).toContain('alice');
      expect(authors).toContain('bob');
    });

    it('User B searches → finds both alice and bob memories', async () => {
      const results = await bobHandler.handleSearch({
        query: 'TypeScript Kubernetes knowledge',
        limit: 10,
        threshold: 0.1,
      });

      expect(results.length).toBe(2);
      const authors = results.map((r) => r.memory.authorId);
      expect(authors).toContain('alice');
      expect(authors).toContain('bob');
    });

    it('List without mine=true shows all accessible memories', async () => {
      const results = await aliceHandler.handleList({ limit: 50 });
      expect(results.memories.length).toBe(2);

      const authors = results.memories.map((m) => m.authorId);
      expect(authors).toContain('alice');
      expect(authors).toContain('bob');
    });
  });

  // ─── Test 3: Ownership enforcement ───────────────────────────────────────

  describe('3. Ownership enforcement (write restricted)', () => {
    let aliceMemoryId: string;

    beforeAll(async () => {
      const result = await aliceHandler.handleStore({
        content: 'Alice private note about project architecture.',
        type: 'context',
      });
      aliceMemoryId = result.id;
    });

    it('User B CANNOT update Alice memory → permission denied', async () => {
      const result = await bobHandler.handleUpdate({
        id: aliceMemoryId,
        content: 'Bob tries to overwrite this.',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Permission denied');
    });

    it('User B CANNOT delete Alice memory → permission denied', async () => {
      const result = await bobHandler.handleDelete({
        id: aliceMemoryId,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Permission denied');
    });

    it('User A CAN update own memory → success', async () => {
      const result = await aliceHandler.handleUpdate({
        id: aliceMemoryId,
        content: 'Alice revised version of the architecture note.',
        tags: { add: ['revised'] },
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('updated successfully');

      const memory = await store.getMemory(aliceMemoryId);
      expect(memory!.content).toContain('revised version');
      expect(memory!.tags).toContain('revised');
    });

    it('User A CAN delete own memory → success', async () => {
      const result = await aliceHandler.handleDelete({
        id: aliceMemoryId,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');

      const memory = await store.getMemory(aliceMemoryId);
      expect(memory!.deleted).toBe(true);
    });
  });

  // ─── Test 4: Memory import and export ────────────────────────────────────

  describe('4. Memory import and export', () => {
    it('memory_import bulk creates memories with correct authorId', async () => {
      const result = await aliceHandler.handleImport({
        memories: [
          { content: 'Import test 1', type: 'fact' },
          { content: 'Import test 2', type: 'procedure' },
          { content: 'Import test 3', type: 'context' },
        ],
        scope: 'personal',
      });

      expect(result.imported).toBe(3);
      expect(result.ids).toHaveLength(3);

      // Verify all have alice as author
      for (const id of result.ids) {
        const memory = await store.getMemory(id);
        expect(memory!.authorId).toBe('alice');
        expect(memory!.authorName).toBe('Alice Smith');
      }
    });

    it('memory_export returns JSON with all accessible memories', async () => {
      const result = await aliceHandler.handleExport({
        format: 'json',
      });

      expect(result).toBeDefined();
      expect(result.format).toBe('json');
      expect(result.count).toBeGreaterThan(0);
      expect(typeof result.data).toBe('string');

      const memories = JSON.parse(result.data);
      expect(Array.isArray(memories)).toBe(true);
      expect(memories.length).toBe(result.count);
    });

    it('memory_export markdown format includes metadata', async () => {
      const result = await aliceHandler.handleExport({
        format: 'markdown',
      });

      expect(result.format).toBe('markdown');
      expect(result.count).toBeGreaterThan(0);
      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('# SharedBrain Export');
      expect(result.data).toContain('Count:');
    });
  });

  // ─── Test 5: Memory relate (semantic similarity) ─────────────────────────

  describe('5. Memory relate (semantic similarity)', () => {
    it('memory_relate finds semantically similar memories', async () => {
      const m1 = await aliceHandler.handleStore({
        content: 'React hooks enable state in functional components',
        type: 'fact',
        tags: ['react', 'javascript'],
      });

      await aliceHandler.handleStore({
        content: 'useState and useEffect are core React hooks',
        type: 'fact',
        tags: ['react'],
      });

      const related = await aliceHandler.handleRelate({
        id: m1.id,
        limit: 5,
        threshold: 0.1,
      });

      expect(related.length).toBeGreaterThan(0);
      const found = related.find((r) => r.memory.content.includes('useState'));
      expect(found).toBeDefined();
      expect(found!.score).toBeGreaterThan(0);
    });

    it('Cross-user relate: Alice can find related memories from Bob', async () => {
      const bobMem = await bobHandler.handleStore({
        content: 'Docker containers provide isolated environments for deployment',
        type: 'fact',
        tags: ['docker', 'devops'],
      });

      await aliceHandler.handleStore({
        content: 'Kubernetes orchestrates Docker containers at scale',
        type: 'fact',
        tags: ['kubernetes', 'docker'],
      });

      const related = await bobHandler.handleRelate({
        id: bobMem.id,
        limit: 5,
        threshold: 0.1,
      });

      // Should find Alice's related memory
      const found = related.find((r) => r.memory.content.includes('Kubernetes orchestrates'));
      expect(found).toBeDefined();
      expect(found!.memory.authorId).toBe('alice');
    });
  });

  // ─── Test 6: Sync status and vector index ────────────────────────────────

  describe('6. Sync status and vector index', () => {
    it('sync_status returns correct pending ops and vector count', async () => {
      const status = await aliceHandler.handleSyncStatus();

      expect(status.pendingOps).toBeGreaterThan(0);
      expect(status.vectorCount).toBeGreaterThan(0);
      expect(status.lastSyncTime).toBeNull();
    });

    it('Vector count increases when memories are stored', async () => {
      const statusBefore = await aliceHandler.handleSyncStatus();
      const countBefore = statusBefore.vectorCount;

      await aliceHandler.handleStore({
        content: 'New memory to test vector indexing',
        type: 'fact',
      });

      const statusAfter = await aliceHandler.handleSyncStatus();
      expect(statusAfter.vectorCount).toBe(countBefore + 1);
    });
  });

  // ─── Test 7: Health checks via HTTP ──────────────────────────────────────

  describe('7. Health checks via HTTP', () => {
    it('GET /health returns ok status', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('shared-brain');
      expect(data.version).toBeDefined();
      expect(data.timestamp).toBeDefined();
    });
  });
});
