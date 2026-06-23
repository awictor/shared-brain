/**
 * Multi-user ownership simulation — generates a report table.
 *
 * Run with: npx tsx src/__tests__/multi-user-report.ts
 *
 * Simulates 5 users, each storing 10 memories, then tests cross-user
 * search, update, and delete operations. Outputs results as a markdown table.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
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

// ─── Simulation ──────────────────────────────────────────────────────────────

interface UserReport {
  user: string;
  stored: number;
  searched: number;
  update_own: string;
  update_other: string;
  delete_own: string;
  delete_other: string;
}

const USERS = ['alice', 'bob', 'charlie', 'dave', 'eve'];
const MEMORIES_PER_USER = 10;

const TOPICS = [
  'TypeScript generics and type inference patterns',
  'Kubernetes pod autoscaling with HPA',
  'PostgreSQL query optimization with explain analyze',
  'React Server Components data fetching',
  'Terraform module composition best practices',
  'Docker multi-stage build caching strategies',
  'GraphQL schema design with federation',
  'Redis pub/sub for real-time notifications',
  'CI/CD pipeline security scanning integration',
  'AWS Lambda cold start mitigation techniques',
];

async function runSimulation(): Promise<void> {
  const store = new InMemoryStore();
  const embeddings = new SimpleEmbeddingEngine();
  const vectorIndex = new InMemoryVectorIndex();

  // Create handlers for each user
  const handlers = new Map<string, MemoryHandler>();
  for (const user of USERS) {
    handlers.set(user, new MemoryHandler(store, embeddings, vectorIndex, user, `${user} (sim)`));
  }

  // Track stored memory IDs per user
  const memoryIds = new Map<string, string[]>();

  // ─── Phase 1: Each user stores 10 memories ──────────────────────────────

  console.log('Phase 1: Storing memories...');
  for (const user of USERS) {
    const handler = handlers.get(user)!;
    const ids: string[] = [];
    for (let i = 0; i < MEMORIES_PER_USER; i++) {
      const topic = TOPICS[i % TOPICS.length];
      const result = await handler.handleStore({
        content: `${user}'s note #${i + 1}: ${topic}`,
        type: 'fact',
        tags: [`user-${user}`, `topic-${i}`],
      });
      ids.push(result.id);
    }
    memoryIds.set(user, ids);
    console.log(`  ${user}: stored ${ids.length} memories`);
  }

  // ─── Phase 2: Each user searches across all memories ────────────────────

  console.log('\nPhase 2: Searching across all memories...');
  const searchCounts = new Map<string, number>();
  for (const user of USERS) {
    const handler = handlers.get(user)!;
    const results = await handler.handleSearch({
      query: 'TypeScript Kubernetes PostgreSQL',
      limit: 50,
      threshold: 0.0,
    });
    searchCounts.set(user, results.length);
    console.log(`  ${user}: found ${results.length} results (isOwner counts: own=${results.filter((r) => r.memory.isOwner).length}, other=${results.filter((r) => !r.memory.isOwner).length})`);
  }

  // ─── Phase 3: Each user tries to update others' and own ────────────────

  console.log('\nPhase 3: Testing update permissions...');
  const updateResults = new Map<string, { own: boolean; other: boolean }>();
  for (const user of USERS) {
    const handler = handlers.get(user)!;
    const ownIds = memoryIds.get(user)!;

    // Update own first memory
    const ownResult = await handler.handleUpdate({
      id: ownIds[0],
      content: `${user}'s UPDATED note #1`,
    });

    // Try to update another user's first memory
    const otherUser = USERS.find((u) => u !== user)!;
    const otherIds = memoryIds.get(otherUser)!;
    const otherResult = await handler.handleUpdate({
      id: otherIds[0],
      content: `${user} trying to overwrite ${otherUser}'s note`,
    });

    updateResults.set(user, { own: ownResult.success, other: otherResult.success });
    console.log(`  ${user}: update own=${ownResult.success ? 'PASS' : 'FAIL'}, update other=${otherResult.success ? 'UNEXPECTED PASS' : 'BLOCKED (correct)'}`);
  }

  // ─── Phase 4: Each user tries to delete others' and own ────────────────

  console.log('\nPhase 4: Testing delete permissions...');
  const deleteResults = new Map<string, { own: boolean; other: boolean }>();
  for (const user of USERS) {
    const handler = handlers.get(user)!;
    const ownIds = memoryIds.get(user)!;

    // Delete own last memory (index 9)
    const ownResult = await handler.handleDelete({ id: ownIds[MEMORIES_PER_USER - 1] });

    // Try to delete another user's memory
    const otherUser = USERS.find((u) => u !== user)!;
    const otherIds = memoryIds.get(otherUser)!;
    const otherResult = await handler.handleDelete({ id: otherIds[1] });

    deleteResults.set(user, { own: ownResult.success, other: otherResult.success });
    console.log(`  ${user}: delete own=${ownResult.success ? 'PASS' : 'FAIL'}, delete other=${otherResult.success ? 'UNEXPECTED PASS' : 'BLOCKED (correct)'}`);
  }

  // ─── Generate report ───────────────────────────────────────────────────

  const reports: UserReport[] = [];
  for (const user of USERS) {
    const update = updateResults.get(user)!;
    const del = deleteResults.get(user)!;
    reports.push({
      user,
      stored: MEMORIES_PER_USER,
      searched: searchCounts.get(user) ?? 0,
      update_own: update.own ? 'PASS' : 'FAIL',
      update_other: update.other ? 'FAIL (should block)' : 'PASS (blocked)',
      delete_own: del.own ? 'PASS' : 'FAIL',
      delete_other: del.other ? 'FAIL (should block)' : 'PASS (blocked)',
    });
  }

  // ─── Format markdown report ─────────────────────────────────────────────

  const lines: string[] = [
    '# Multi-User Ownership Test Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Configuration',
    '',
    `- Users: ${USERS.length}`,
    `- Memories per user: ${MEMORIES_PER_USER}`,
    `- Total memories stored: ${USERS.length * MEMORIES_PER_USER}`,
    '',
    '## Results',
    '',
    '| User | Stored | Searched | Update Own | Update Other | Delete Own | Delete Other |',
    '|------|--------|----------|------------|--------------|------------|--------------|',
  ];

  for (const r of reports) {
    lines.push(`| ${r.user} | ${r.stored} | ${r.searched} | ${r.update_own} | ${r.update_other} | ${r.delete_own} | ${r.delete_other} |`);
  }

  // Summary
  const allUpdateOwnPass = reports.every((r) => r.update_own === 'PASS');
  const allUpdateOtherBlocked = reports.every((r) => r.update_other === 'PASS (blocked)');
  const allDeleteOwnPass = reports.every((r) => r.delete_own === 'PASS');
  const allDeleteOtherBlocked = reports.every((r) => r.delete_other === 'PASS (blocked)');
  const allSearched = reports.every((r) => r.searched > 0);

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Shared read (cross-user search): ${allSearched ? 'ALL PASS' : 'SOME FAILED'}`);
  lines.push(`- Owner can update own: ${allUpdateOwnPass ? 'ALL PASS' : 'SOME FAILED'}`);
  lines.push(`- Non-owner blocked from update: ${allUpdateOtherBlocked ? 'ALL PASS' : 'SOME FAILED'}`);
  lines.push(`- Owner can delete own: ${allDeleteOwnPass ? 'ALL PASS' : 'SOME FAILED'}`);
  lines.push(`- Non-owner blocked from delete: ${allDeleteOtherBlocked ? 'ALL PASS' : 'SOME FAILED'}`);
  lines.push('');

  const overallPass = allUpdateOwnPass && allUpdateOtherBlocked && allDeleteOwnPass && allDeleteOtherBlocked && allSearched;
  lines.push(`**Overall: ${overallPass ? 'ALL OWNERSHIP CHECKS PASSED' : 'SOME CHECKS FAILED — see table above'}**`);
  lines.push('');

  const markdown = lines.join('\n');

  // Write report file
  const outputDir = 'C:\\Users\\awictor\\Documents\\claude-output';
  const outputPath = `${outputDir}\\ownership-test-report.md`;

  try {
    mkdirSync(outputDir, { recursive: true });
  } catch {
    // directory already exists
  }

  writeFileSync(outputPath, markdown, 'utf-8');
  console.log(`\nReport saved to: ${outputPath}`);
  console.log('\n' + markdown);
}

// Run
runSimulation().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
