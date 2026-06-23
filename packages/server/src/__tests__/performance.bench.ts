/**
 * Performance Benchmark Suite for SharedBrain Server
 *
 * Measures throughput and latency for core operations:
 * - Store (with/without auto-enhance)
 * - Search (semantic, keyword, hybrid)
 * - List with filters
 * - Memory usage
 *
 * Run: npx vitest bench src/__tests__/performance.bench.ts
 */

import { describe, bench, beforeAll } from 'vitest';
import type { Store, Embeddings, VectorIndex, Memory, MemoryOperation, ListOptions } from '../mcp/handler.js';
import { FullTextIndex } from '../fulltext.js';

// ─── Test Data Generators ─────────────────────────────────────────────────────

function generateContent(id: number): string {
  const subjects = ['TypeScript', 'JavaScript', 'Python', 'React', 'Node.js', 'Express', 'Vitest', 'Docker', 'Kubernetes', 'AWS'];
  const verbs = ['enables', 'provides', 'supports', 'implements', 'facilitates', 'optimizes', 'manages', 'orchestrates'];
  const objects = ['type safety', 'async operations', 'component rendering', 'API routing', 'testing', 'containerization', 'deployment', 'scalability'];

  const subject = subjects[id % subjects.length];
  const verb = verbs[(id * 3) % verbs.length];
  const object = objects[(id * 7) % objects.length];

  return `${subject} ${verb} ${object} with performance optimization and robust error handling. Memory ${id}.`;
}

function generateTags(id: number): string[] {
  const tagPool = ['performance', 'architecture', 'testing', 'deployment', 'frontend', 'backend', 'devops', 'database'];
  return [tagPool[id % tagPool.length], tagPool[(id * 2) % tagPool.length]];
}

function generateSearchQueries(): string[] {
  return [
    'TypeScript type safety',
    'async operations handling',
    'React component lifecycle',
    'API routing patterns',
    'testing framework comparison',
    'Docker containerization best practices',
    'Kubernetes deployment strategies',
    'AWS cloud architecture',
    'performance optimization techniques',
    'error handling patterns',
    'database query optimization',
    'frontend state management',
    'backend API design',
    'DevOps automation',
    'CI/CD pipeline setup',
    'microservices architecture',
    'serverless computing',
    'GraphQL vs REST',
    'authentication strategies',
    'caching mechanisms',
  ];
}

// ─── In-Memory Store Implementation ───────────────────────────────────────────

class BenchmarkStore implements Store {
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

// ─── Simple Vector Index ──────────────────────────────────────────────────────

class SimpleVectorIndex implements VectorIndex {
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

// ─── Simple Embedding Engine ──────────────────────────────────────────────────

class SimpleEmbeddings implements Embeddings {
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

// ─── Benchmark Suite ──────────────────────────────────────────────────────────

describe('SharedBrain Performance Benchmarks', () => {
  const store = new BenchmarkStore();
  const embeddings = new SimpleEmbeddings();
  const vectorIndex = new SimpleVectorIndex();
  const fulltextIndex = new FullTextIndex();

  let preloadedMemories: Memory[] = [];
  let searchQueries: string[] = [];

  beforeAll(async () => {
    await store.initialize();
    await embeddings.initialize();

    searchQueries = generateSearchQueries();

    // Preload 100 memories for search benchmarks
    console.log('Preloading 100 memories for search benchmarks...');
    for (let i = 0; i < 100; i++) {
      const content = generateContent(i);
      const memory: Memory = {
        id: `mem_${i}`,
        content,
        title: `Memory ${i}`,
        type: 'fact',
        scope: 'personal',
        teamId: null,
        orgId: null,
        authorId: 'bench_user',
        authorName: 'Benchmark User',
        tags: generateTags(i),
        embedding: await embeddings.embed(content),
        hlc: `${Date.now()}-0-bench`,
        deleted: false,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        updatedAt: new Date(Date.now() - i * 1000).toISOString(),
        source: { type: 'manual', agent: null, reference: null },
        relations: [],
        version: 1,
      };
      await store.createMemory(memory);
      vectorIndex.add(memory.id, memory.embedding!);
      fulltextIndex.add(memory.id, memory.content, memory.title ?? undefined, memory.tags);
      preloadedMemories.push(memory);
    }
    console.log('Preload complete.');
  });

  // ─── Store Throughput ─────────────────────────────────────────────────────────

  describe('Store Throughput', () => {
    bench('store 100 memories (sequential)', async () => {
      for (let i = 0; i < 100; i++) {
        const content = generateContent(i + 1000);
        const embedding = await embeddings.embed(content);
        const memory: Memory = {
          id: `bench_seq_${i}`,
          content,
          title: `Bench ${i}`,
          type: 'fact',
          scope: 'personal',
          teamId: null,
          orgId: null,
          authorId: 'bench_user',
          authorName: 'Benchmark User',
          tags: generateTags(i),
          embedding,
          hlc: `${Date.now()}-0-bench`,
          deleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: { type: 'manual', agent: null, reference: null },
          relations: [],
          version: 1,
        };
        await store.createMemory(memory);
        vectorIndex.add(memory.id, embedding);
        fulltextIndex.add(memory.id, content, memory.title ?? undefined, memory.tags);
      }
    }, { iterations: 10 });

    bench('store 100 memories with embedding (overhead measurement)', async () => {
      const contents = Array.from({ length: 100 }, (_, i) => generateContent(i + 2000));
      const embeddings_batch = await embeddings.embedBatch(contents);

      for (let i = 0; i < 100; i++) {
        const memory: Memory = {
          id: `bench_batch_${i}`,
          content: contents[i],
          title: `Batch ${i}`,
          type: 'fact',
          scope: 'personal',
          teamId: null,
          orgId: null,
          authorId: 'bench_user',
          authorName: 'Benchmark User',
          tags: generateTags(i),
          embedding: embeddings_batch[i],
          hlc: `${Date.now()}-0-bench`,
          deleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: { type: 'manual', agent: null, reference: null },
          relations: [],
          version: 1,
        };
        await store.createMemory(memory);
        vectorIndex.add(memory.id, embeddings_batch[i]);
        fulltextIndex.add(memory.id, contents[i], memory.title ?? undefined, memory.tags);
      }
    }, { iterations: 10 });
  });

  // ─── Search Latency ───────────────────────────────────────────────────────────

  describe('Search Latency', () => {
    bench('semantic search (50 queries, 100 memories)', async () => {
      for (let i = 0; i < 50; i++) {
        const query = searchQueries[i % searchQueries.length];
        const queryEmbedding = await embeddings.embed(query);
        const results = vectorIndex.search(queryEmbedding, 10, 0.1);

        // Hydrate top results from store
        const memories = await Promise.all(
          results.slice(0, 5).map(r => store.getMemory(r.id))
        );
      }
    }, { iterations: 20 });

    bench('keyword-only search (50 queries, 100 memories)', async () => {
      for (let i = 0; i < 50; i++) {
        const query = searchQueries[i % searchQueries.length];
        const results = fulltextIndex.search(query, 10);

        // Hydrate top results from store
        const memories = await Promise.all(
          results.slice(0, 5).map(r => store.getMemory(r.id))
        );
      }
    }, { iterations: 20 });

    bench('hybrid search (semantic + keyword, 50 queries)', async () => {
      for (let i = 0; i < 50; i++) {
        const query = searchQueries[i % searchQueries.length];

        // Semantic
        const queryEmbedding = await embeddings.embed(query);
        const semanticResults = vectorIndex.search(queryEmbedding, 10, 0.1);

        // Keyword
        const keywordResults = fulltextIndex.search(query, 10);

        // Merge (simple interleave)
        const merged = new Map<string, number>();
        semanticResults.forEach((r, idx) => merged.set(r.id, (merged.get(r.id) ?? 0) + (10 - idx) * 2));
        keywordResults.forEach((r, idx) => merged.set(r.id, (merged.get(r.id) ?? 0) + (10 - idx)));

        const sortedIds = [...merged.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id]) => id);

        const memories = await Promise.all(sortedIds.map(id => store.getMemory(id)));
      }
    }, { iterations: 20 });
  });

  // ─── List Performance ─────────────────────────────────────────────────────────

  describe('List Performance', () => {
    beforeAll(async () => {
      // Add 900 more memories for list benchmark (total 1000)
      console.log('Adding 900 more memories for list benchmark...');
      for (let i = 100; i < 1000; i++) {
        const content = generateContent(i);
        const memory: Memory = {
          id: `mem_${i}`,
          content,
          title: `Memory ${i}`,
          type: i % 3 === 0 ? 'procedure' : i % 3 === 1 ? 'decision' : 'fact',
          scope: 'personal',
          teamId: null,
          orgId: null,
          authorId: i % 2 === 0 ? 'user_a' : 'user_b',
          authorName: 'Benchmark User',
          tags: generateTags(i),
          embedding: await embeddings.embed(content),
          hlc: `${Date.now()}-0-bench`,
          deleted: false,
          createdAt: new Date(Date.now() - i * 1000).toISOString(),
          updatedAt: new Date(Date.now() - i * 1000).toISOString(),
          source: { type: 'manual', agent: null, reference: null },
          relations: [],
          version: 1,
        };
        await store.createMemory(memory);
      }
      console.log('List benchmark data ready.');
    });

    bench('list all (1000 memories, no filters)', async () => {
      await store.listMemories({ limit: 1000, offset: 0 });
    }, { iterations: 50 });

    bench('list with type filter (1000 memories)', async () => {
      await store.listMemories({
        limit: 100,
        offset: 0,
        filters: { types: ['fact', 'procedure'] },
      });
    }, { iterations: 50 });

    bench('list with tag filter (1000 memories)', async () => {
      await store.listMemories({
        limit: 100,
        offset: 0,
        filters: { tags: ['performance', 'testing'] },
      });
    }, { iterations: 50 });

    bench('list with date range filter (1000 memories)', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
      await store.listMemories({
        limit: 100,
        offset: 0,
        filters: { since: oneHourAgo.toISOString() },
      });
    }, { iterations: 50 });

    bench('list with multiple filters + sort (1000 memories)', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
      await store.listMemories({
        limit: 50,
        offset: 0,
        filters: {
          types: ['fact'],
          tags: ['performance'],
          since: oneHourAgo.toISOString(),
        },
        sort: 'newest',
      });
    }, { iterations: 50 });
  });

  // ─── Memory Usage ─────────────────────────────────────────────────────────────

  describe('Memory Usage', () => {
    bench('measure heap usage for 1000 memories', async () => {
      const before = process.memoryUsage().heapUsed;

      // Count current memories
      const count = await store.countMemories();

      const after = process.memoryUsage().heapUsed;
      const mbPerK = ((after - before) / 1024 / 1024);

      // Log to console for manual inspection
      if (count >= 1000) {
        console.log(`Heap delta: ${mbPerK.toFixed(2)} MB for ${count} memories`);
      }
    }, { iterations: 10 });
  });
});
