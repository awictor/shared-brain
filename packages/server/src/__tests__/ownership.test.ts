/**
 * Ownership model integration tests for SharedBrain MCP server.
 *
 * Verifies multi-user ownership enforcement:
 * - Shared read access (anyone can search/view)
 * - Write access restricted to memory author
 * - authorId always stamped from currentUserId
 * - isOwner indicator in results
 * - mine=true list filter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryHandler } from '../mcp/handler.js';
import type { Store, Embeddings, VectorIndex, Memory, MemoryOperation, ListOptions, ScopeFilter } from '../mcp/handler.js';

// ─── In-memory implementations ───────────────────────────────────────────────

class InMemoryStore implements Store {
  private memories: Map<string, Memory> = new Map();
  private operations: MemoryOperation[] = [];

  async initialize(): Promise<void> {}

  async createMemory(memory: Memory): Promise<void> {
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

  async countMemories(_scope?: ScopeFilter): Promise<number> {
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
      for (let i = 0; i < query.length; i++) dot += query[i] * vector[i];
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

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('Multi-User Ownership Model', () => {
  let store: InMemoryStore;
  let embeddings: SimpleEmbeddingEngine;
  let vectorIndex: InMemoryVectorIndex;
  let alice: MemoryHandler;
  let bob: MemoryHandler;

  beforeEach(() => {
    store = new InMemoryStore();
    embeddings = new SimpleEmbeddingEngine();
    vectorIndex = new InMemoryVectorIndex();

    // Two handlers sharing the same store/index but with different user identities
    alice = new MemoryHandler(store, embeddings, vectorIndex, undefined, 'alice', 'Alice Smith');
    bob = new MemoryHandler(store, embeddings, vectorIndex, undefined, 'bob', 'Bob Jones');
  });

  // ─── Test 1: memory_store stamps authorId ──────────────────────────────────

  describe('memory_store stamps authorId', () => {
    it('User A stores a memory and it has authorId = user-a', async () => {
      const result = await alice.handleStore({
        content: 'Alice knows about TypeScript generics.',
        type: 'fact',
        tags: ['typescript'],
      });

      expect(result.id).toBeDefined();

      // Verify the stored memory has Alice's ID
      const memory = await store.getMemory(result.id);
      expect(memory).not.toBeNull();
      expect(memory!.authorId).toBe('alice');
      expect(memory!.authorName).toBe('Alice Smith');
    });
  });

  // ─── Test 2: Shared read — User B can search and find User A's memory ─────

  describe('shared read access', () => {
    it('User B can search and find User A memory', async () => {
      // Alice stores a memory
      await alice.handleStore({
        content: 'The deployment pipeline uses blue-green strategy.',
        type: 'procedure',
        tags: ['deploy'],
      });

      // Bob searches and finds it
      const results = await bob.handleSearch({
        query: 'deployment pipeline blue-green',
        limit: 10,
        threshold: 0.1,
      });

      expect(results.length).toBeGreaterThan(0);
      const found = results.find((r) => r.memory.content.includes('blue-green'));
      expect(found).toBeDefined();
      expect(found!.memory.authorId).toBe('alice');
    });
  });

  // ─── Test 3: User B CANNOT update User A's memory ─────────────────────────

  describe('ownership enforcement on update', () => {
    it('User B cannot update User A memory (permission denied)', async () => {
      const stored = await alice.handleStore({
        content: 'Original content by Alice.',
        type: 'fact',
      });

      // Bob tries to update Alice's memory
      const result = await bob.handleUpdate({
        id: stored.id,
        content: 'Bob tries to overwrite this.',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Permission denied');

      // Verify content unchanged
      const memory = await store.getMemory(stored.id);
      expect(memory!.content).toBe('Original content by Alice.');
    });
  });

  // ─── Test 4: User B CANNOT delete User A's memory ─────────────────────────

  describe('ownership enforcement on delete', () => {
    it('User B cannot delete User A memory (permission denied)', async () => {
      const stored = await alice.handleStore({
        content: 'Alice private knowledge.',
        type: 'context',
      });

      // Bob tries to delete Alice's memory
      const result = await bob.handleDelete({ id: stored.id });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Permission denied');

      // Verify memory still exists and is not deleted
      const memory = await store.getMemory(stored.id);
      expect(memory!.deleted).toBe(false);
    });
  });

  // ─── Test 5: User A CAN update their own memory ───────────────────────────

  describe('owner can update their own memory', () => {
    it('User A can update their own memory (ownership allowed)', async () => {
      const stored = await alice.handleStore({
        content: 'First draft by Alice.',
        type: 'fact',
        tags: ['draft'],
      });

      const result = await alice.handleUpdate({
        id: stored.id,
        content: 'Revised version by Alice.',
        tags: { add: ['revised'], remove: ['draft'] },
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('updated successfully');

      // Verify update persisted
      const memory = await store.getMemory(stored.id);
      expect(memory!.content).toBe('Revised version by Alice.');
      expect(memory!.tags).toContain('revised');
      expect(memory!.tags).not.toContain('draft');
    });
  });

  // ─── Test 6: User A CAN delete their own memory ───────────────────────────

  describe('owner can delete their own memory', () => {
    it('User A can delete their own memory (ownership allowed)', async () => {
      const stored = await alice.handleStore({
        content: 'Temporary note by Alice.',
        type: 'context',
      });

      const result = await alice.handleDelete({ id: stored.id });

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted');

      // Verify soft-deleted
      const memory = await store.getMemory(stored.id);
      expect(memory!.deleted).toBe(true);
    });
  });

  // ─── Test 7: memory_list with mine=true only returns caller's memories ────

  describe('memory_list with mine=true', () => {
    it('only returns the caller own memories', async () => {
      // Both users store memories
      await alice.handleStore({ content: 'Alice memory one.', type: 'fact' });
      await alice.handleStore({ content: 'Alice memory two.', type: 'fact' });
      await bob.handleStore({ content: 'Bob memory one.', type: 'fact' });
      await bob.handleStore({ content: 'Bob memory two.', type: 'decision' });
      await bob.handleStore({ content: 'Bob memory three.', type: 'context' });

      // Alice lists with mine=true — should only see her 2
      const aliceList = await alice.handleList({ mine: true, limit: 50 });
      expect(aliceList.memories.length).toBe(2);
      for (const m of aliceList.memories) {
        expect(m.authorId).toBe('alice');
      }

      // Bob lists with mine=true — should only see his 3
      const bobList = await bob.handleList({ mine: true, limit: 50 });
      expect(bobList.memories.length).toBe(3);
      for (const m of bobList.memories) {
        expect(m.authorId).toBe('bob');
      }
    });
  });

  // ─── Test 8: memory_list without mine returns all accessible memories ─────

  describe('memory_list without mine returns all', () => {
    it('returns all accessible memories regardless of author', async () => {
      await alice.handleStore({ content: 'Alice shared note.', type: 'fact' });
      await bob.handleStore({ content: 'Bob shared note.', type: 'fact' });

      // Bob lists without mine — should see both
      const result = await bob.handleList({ limit: 50 });
      expect(result.memories.length).toBe(2);

      const authors = result.memories.map((m) => m.authorId);
      expect(authors).toContain('alice');
      expect(authors).toContain('bob');
    });
  });

  // ─── Test 9: authorId always stamped from currentUserId ────────────────────

  describe('authorId always stamped from currentUserId', () => {
    it('ignores any authorId the caller might pass — stamps from handler identity', async () => {
      // Even if the store params somehow contained an authorId override,
      // the handler should always use its own _currentUserId.
      const result = await bob.handleStore({
        content: 'Bob claims to be Alice in the params.',
        type: 'fact',
        // Note: StoreParams does not have an authorId field by design,
        // so we test that the memory is stamped with bob regardless
      });

      const memory = await store.getMemory(result.id);
      expect(memory!.authorId).toBe('bob');
      expect(memory!.authorName).toBe('Bob Jones');
    });

    it('stores correct authorId even after setCurrentUser is called', async () => {
      const handler = new MemoryHandler(store, embeddings, vectorIndex, undefined, 'charlie', 'Charlie');

      const r1 = await handler.handleStore({ content: 'Charlie note.', type: 'fact' });
      expect((await store.getMemory(r1.id))!.authorId).toBe('charlie');

      handler.setCurrentUser('dave', 'Dave');

      const r2 = await handler.handleStore({ content: 'Dave note.', type: 'fact' });
      expect((await store.getMemory(r2.id))!.authorId).toBe('dave');
    });
  });

  // ─── Test 10: Search results include isOwner indicator ─────────────────────

  describe('search results include isOwner indicator', () => {
    it('isOwner=true for own memories, false for others', async () => {
      // Alice stores
      await alice.handleStore({
        content: 'Kubernetes pod autoscaling configuration.',
        type: 'procedure',
        tags: ['k8s'],
      });

      // Bob stores
      await bob.handleStore({
        content: 'Kubernetes service mesh with Istio setup.',
        type: 'procedure',
        tags: ['k8s'],
      });

      // Bob searches — should see isOwner=true for his, false for Alice's
      const bobResults = await bob.handleSearch({
        query: 'kubernetes',
        limit: 10,
        threshold: 0.1,
      });

      expect(bobResults.length).toBe(2);
      const bobOwn = bobResults.find((r) => r.memory.authorId === 'bob');
      const aliceMemory = bobResults.find((r) => r.memory.authorId === 'alice');

      expect(bobOwn).toBeDefined();
      expect(bobOwn!.memory.isOwner).toBe(true);

      expect(aliceMemory).toBeDefined();
      expect(aliceMemory!.memory.isOwner).toBe(false);
    });

    it('handleGet also includes isOwner indicator', async () => {
      const stored = await alice.handleStore({
        content: 'Alice secret recipe.',
        type: 'fact',
      });

      // Alice gets it — isOwner should be true
      const aliceView = await alice.handleGet({ id: stored.id });
      expect(aliceView).not.toBeNull();
      expect(aliceView!.isOwner).toBe(true);

      // Bob gets it — isOwner should be false
      const bobView = await bob.handleGet({ id: stored.id });
      expect(bobView).not.toBeNull();
      expect(bobView!.isOwner).toBe(false);
    });

    it('handleList also includes isOwner indicator', async () => {
      await alice.handleStore({ content: 'Alice list item.', type: 'fact' });
      await bob.handleStore({ content: 'Bob list item.', type: 'fact' });

      const bobList = await bob.handleList({ limit: 50 });
      const bobOwn = bobList.memories.find((m) => m.authorId === 'bob');
      const aliceItem = bobList.memories.find((m) => m.authorId === 'alice');

      expect(bobOwn!.isOwner).toBe(true);
      expect(aliceItem!.isOwner).toBe(false);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('updating non-existent memory returns not found (not permission error)', async () => {
      const result = await alice.handleUpdate({
        id: '00000000-0000-0000-0000-000000000000',
        content: 'ghost memory',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('deleting non-existent memory returns not found (not permission error)', async () => {
      const result = await bob.handleDelete({
        id: '00000000-0000-0000-0000-000000000000',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('deleted memories are not returned in search', async () => {
      const stored = await alice.handleStore({
        content: 'This will be deleted soon.',
        type: 'fact',
      });

      await alice.handleDelete({ id: stored.id });

      const results = await bob.handleSearch({
        query: 'deleted soon',
        limit: 10,
        threshold: 0.0,
      });

      const found = results.find((r) => r.memory.id === stored.id);
      expect(found).toBeUndefined();
    });
  });
});
